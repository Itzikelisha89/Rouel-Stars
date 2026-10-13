"""Hebrew TTS with F5-TTS Hebrew v2 + Phonikud diacritics (stress-marked)."""
import os, sys, re, torch, soundfile as sf, numpy as np
from safetensors.torch import load_file
import torchaudio
def _sf_load(path, *a, **k):  # avoid the torchcodec dependency
    y, sr = sf.read(path, dtype='float32', always_2d=True)
    return torch.from_numpy(y.T.copy()), sr
torchaudio.load = _sf_load
from f5_tts.model import CFM, DiT
from f5_tts.model.utils import get_tokenizer
from f5_tts.infer.utils_infer import load_vocoder, infer_process, preprocess_ref_audio_text
from phonikud_onnx import Phonikud

D = os.environ.get('F5_HE_DIR', 'f5')  # model.safetensors + vocab.txt (Yzamari/f5tts-hebrew-v2) + phonikud.onnx
torch.set_num_threads(4)
_vocab, _n = get_tokenizer(f'{D}/vocab.txt', 'custom')
_model = CFM(
    transformer=DiT(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, text_mask_padding=True, conv_layers=4,
                    text_num_embeds=_n, mel_dim=100),
    mel_spec_kwargs=dict(n_fft=1024, hop_length=256, win_length=1024, n_mel_channels=100, target_sample_rate=24000, mel_spec_type='vocos'),
    odeint_kwargs=dict(method='euler'), vocab_char_map=_vocab)
missing, unexpected = _model.load_state_dict(load_file(f'{D}/model.safetensors'), strict=False)
assert not [m for m in missing if 'mel_spec' not in m], missing
_model.eval()
_vocoder = load_vocoder('vocos', device='cpu')
_nikud = Phonikud(f'{D}/phonikud.onnx')

def vocalize(text):
    return _nikud.add_diacritics(text).replace('|', '')

def synth(text, ref_wav, ref_text, out, speed=1.0, nfe=32, cfg=2.0, seed=None):
    if seed is not None: torch.manual_seed(seed)
    gen = vocalize(text)
    ref_audio, ref_t = preprocess_ref_audio_text(ref_wav, vocalize(ref_text), show_info=lambda *a: None)
    wav, sr, _ = infer_process(ref_audio, ref_t, gen, _model, _vocoder, mel_spec_type='vocos', speed=speed,
                               nfe_step=nfe, cfg_strength=cfg, device='cpu', show_info=lambda *a: None, progress=None)
    sf.write(out, wav, sr)
    return gen, len(wav) / sr
