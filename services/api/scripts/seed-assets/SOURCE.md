# Local streaming test source

The optional real-video fixture is **Big Buck Bunny**, copyright 2008 Blender Foundation /
bigbuckbunny.org, licensed under Creative Commons Attribution 3.0.

- Project and license: https://peach.blender.org/about/
- Official video page: https://video.blender.org/w/dmhvQNzwBnrWy1iYzVv5g7
- Downloaded rendition: the official 480p MP4 exposed by Blender's PeerTube API

The downloaded source and generated HLS files are intentionally gitignored. Regenerate the ten 30-second
portrait fixtures with:

```bash
python gen-hls.py --source source/big-buck-bunny-480p.mp4 --ffmpeg /path/to/ffmpeg
```
