"""Person matte with rembg + u2net_human_seg, computed once and cached to disk."""
import os
import cv2
import numpy as np

_session = None


def _sess():
    global _session
    if _session is None:
        from rembg import new_session
        _session = new_session("u2net_human_seg")
    return _session


def matte(bgr):
    from rembg import remove
    from PIL import Image
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    m = remove(Image.fromarray(rgb), only_mask=True, session=_sess())
    m = np.asarray(m).astype(np.float32) / 255.0
    # tidy: close small holes, soften the edge slightly
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    # drop small stray blobs: keep components >= 15% of the largest
    n, lab, st, _ = cv2.connectedComponentsWithStats((m > 0.5).astype(np.uint8))
    if n > 2:
        areas = st[1:, cv2.CC_STAT_AREA]
        keep = np.isin(lab, 1 + np.where(areas >= 0.15 * areas.max())[0])
        m = m * cv2.dilate(keep.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)
    return cv2.GaussianBlur(m, (0, 0), 1.2)


def photo_mask(path, cache_dir):
    os.makedirs(cache_dir, exist_ok=True)
    out = os.path.join(cache_dir, os.path.splitext(os.path.basename(path))[0] + "_mask.png")
    if not os.path.exists(out):
        m = matte(cv2.imread(path))
        cv2.imwrite(out, (m * 255).astype(np.uint8))
    return cv2.imread(out, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255.0


def video_masks(video_path, cache_npz, size=(540, 960)):
    """One matte per frame of a real video, stored as uint8 (N,h,w) in an .npz."""
    if os.path.exists(cache_npz):
        return np.load(cache_npz)["masks"]
    cap = cv2.VideoCapture(video_path)
    ms = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        ms.append((cv2.resize(matte(fr), size) * 255).astype(np.uint8))
    arr = np.stack(ms)
    np.savez_compressed(cache_npz, masks=arr)
    return arr
