# FAULTWARD

A browser-based tactical 5v5 shooter with bots, multiplayer lobbies, destructible walls, gadgets, and three maps: Qalat Village, Sarai Bazaar, and Oil Camp.

## Play

1. Extract the entire ZIP on a Windows x64 PC.
2. Open `START_GAME.cmd`. The game opens in your browser.
3. Create an account, then choose Play.

The required runtime and game files are included. No installation or build is needed. Keep the launcher window open while playing; close it or press Ctrl+C to stop the game. If the browser does not open, use the address printed in that window.

## Controls

| Key | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Left / right mouse | Fire / aim |
| R | Reload |
| Space / C / Shift | Jump / crouch / walk |
| Q / E | Lean |
| F | Use, pick up, defuse |
| B | Buy |
| X | Specialist gadget |
| Tab | Scoreboard |
| Esc | Menu and settings |

Open Settings to adjust graphics, sound, mouse sensitivity, and key bindings.

## Saved accounts and settings

The game creates a `user` folder beside the launcher. To transfer your accounts and settings, close both copies of the game and copy that folder to the new game folder. Keep a backup before replacing an existing `user` folder.

Optional server settings are in `.env.example`; copy it to `.env` to change them. The default address is `http://127.0.0.1:5000`. The launcher chooses another port if needed.

## Package

This repository contains the ready-to-run Windows game. The compiled client, server, game assets, and required dependencies are included. Development tools and tests are omitted. Third-party licenses are included with the runtime and dependencies; see `THIRD_PARTY_NOTICES.txt`.
