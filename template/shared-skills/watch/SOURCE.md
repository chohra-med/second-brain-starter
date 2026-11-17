# Source of this skill

- Upstream: https://github.com/bradautomates/claude-video, folder `skills/watch`
- Pinned commit: 03ceb42f7fa2c4439aca01752118044baabffb8f, version 0.3.2
- Licence: MIT, copy in `LICENSE` beside this file
- Copied unchanged: `SKILL.md` and the ten scripts in `scripts/` (`config.py`, `download.py`, `frames.py`, `gemini.py`, `local_whisperx.py`, `runtime.py`, `setup.py`, `transcribe.py`, `watch.py`, `whisper.py`)
- Left out: `scripts/build-skill.sh` (upstream packaging only), the plugin's session-start hook, and the upstream repository's other folders (docs, tests, hooks)
- Local changes: none. The starter's skill lint pins one known best-practice FLAG for this skill (its description has no "Use when" phrase) instead of editing the upstream text
- Updating: the copy stays on the pinned commit. Run the security check on a newer commit in a scratch folder before you replace any file

## What leaves your machine

The skill runs yt-dlp, ffmpeg and Python scripts on your machine. Three of its choices send content to an outside service:

| Choice | What is sent | Where |
|---|---|---|
| Gemini engine (needs a Gemini API key) | The video itself, or its YouTube address, with your question | Google |
| Groq or OpenAI transcription backend (needs that service's API key) | The audio track of the video | Groq or OpenAI |
| Local engine with WhisperX | Nothing. Frames, audio and transcript stay on your machine; setup downloads tools and models once | Package and model downloads only |

The skill's own text recommends the Gemini engine and asks you to choose an engine on first use. **For a private video, choose the local engine and decline the cloud transcription backends.** Use Gemini, Groq or OpenAI only for videos you would be willing to send to that service.

## Security check

The starter's `security-check` gives FLAG, no BLOCK, on this folder: network calls (only for the Gemini engine and the cloud backends), addresses in code, one download piped to a shell and package installs in `scripts/setup.py`, and executable script files. Each FLAG is expected; read them before you use the skill. An earlier BLOCK on `scripts/whisper.py` was a false positive (a line ending in a credential-like name followed by a line that starts a statement) and was fixed in the key rule of the check, not in this folder.
