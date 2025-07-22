const express = require('express');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');

const app = express();
const port = 3000;

ffmpeg.setFfmpegPath(ffmpegPath);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.post('/download', multer().none(), async (req, res) => {
    console.log('req.body:', req.body);
    let videoUrl = req.body.url;
    if (!videoUrl) {
        return res.status(400).send('No URL provided');
    }

    // Sanitize and extract video ID
    function extractVideoId(url) {
        url = url.trim();
        // Add protocol if missing
        if (!/^https?:\/\//i.test(url)) {
            url = 'https://' + url;
        }
        try {
            const parsed = new URL(url);
            if (parsed.hostname === 'youtu.be') {
                return parsed.pathname.replace('/', '');
            } else if (parsed.hostname.includes('youtube.com')) {
                return parsed.searchParams.get('v');
            }
        } catch (e) {
            // Fallback to regex
            const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
            if (match) return match[1];
            return null;
        }
        return null;
    }
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
        return res.status(400).send('Invalid YouTube URL');
    }
    videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log('Original URL:', req.body.url);
    console.log('Extracted video ID:', videoId);
    console.log('Final video URL:', videoUrl);

    if (!ytdl.validateID(videoId)) {
        return res.status(400).send('Invalid YouTube URL');
    }

    try {
        const info = await ytdl.getInfo(videoUrl, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            }
        });
        const title = info.videoDetails.title.replace(/[<>:"/\\|?*]+/g, '');
        const videoStream = ytdl(videoUrl, { filter: 'videoonly' });
        const audioStream = ytdl(videoUrl, { filter: 'audioonly' });

        const tempDir = os.tmpdir();
        const videoPath = path.join(tempDir, `${title}_video.mp4`);
        const audioPath = path.join(tempDir, `${title}_audio.mp4`);
        const outputPath = path.join(__dirname, 'downloads', `${title}.mp4`);

        if (!fs.existsSync(path.join(__dirname, 'downloads'))) {
            fs.mkdirSync(path.join(__dirname, 'downloads'));
        }

        const videoWriteStream = fs.createWriteStream(videoPath);
        const audioWriteStream = fs.createWriteStream(audioPath);

        videoStream.pipe(videoWriteStream);
        audioStream.pipe(audioWriteStream);

        const onVideoEnd = new Promise(resolve => videoWriteStream.on('finish', resolve));
        const onAudioEnd = new Promise(resolve => audioWriteStream.on('finish', resolve));

        await Promise.all([onVideoEnd, onAudioEnd]);

        ffmpeg()
            .input(videoPath)
            .input(audioPath)
            .videoCodec('copy')
            .audioCodec('aac')
            .save(outputPath)
            .on('end', () => {
                fs.unlinkSync(videoPath);
                fs.unlinkSync(audioPath);
                res.download(outputPath, (err) => {
                    if (err) {
                        console.error(err);
                    }
                    fs.unlinkSync(outputPath);
                });
            })
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                fs.unlinkSync(videoPath);
                fs.unlinkSync(audioPath);
                res.status(500).send('Error processing video');
            });

    } catch (error) {
        console.error('Detailed error:', error);
        if (error.message && error.message.includes('This video is unavailable')) {
            res.status(404).send('This video is unavailable or restricted.');
        } else if (error.message && error.message.includes('Could not extract video metadata')) {
            res.status(500).send('Could not extract video metadata. Try another video.');
        } else {
            res.status(500).send('Error fetching video info. The video may be restricted or blocked.');
        }
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});