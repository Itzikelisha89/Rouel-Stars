// גרסה לוואטסאפ: H.264 1080x1920, איכות גבוהה ומשקל סביר (נשלחת בלי דחיסה כבדה כשהיא מתחת ל-~60MB).
const { execFileSync } = require('child_process');
const path = require('path');
const B = path.join(__dirname, '..', 'build');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(B, 'ROI_DROR_FullHD.mp4'),
  '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'slow', '-crf', '20', '-maxrate', '6M', '-bufsize', '12M',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', path.join(B, 'ROI_DROR_WhatsApp.mp4')], { stdio: 'inherit' });
console.log('->', path.join(B, 'ROI_DROR_WhatsApp.mp4'));
