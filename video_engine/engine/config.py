"""Frame size for the whole engine. Set VE_SIZE=1920x1080 (landscape/TV) before importing; default is a vertical reel."""
import os
W, H = (int(v) for v in os.environ.get("VE_SIZE", "1080x1920").split("x"))
