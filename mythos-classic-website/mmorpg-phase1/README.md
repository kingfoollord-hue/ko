# Mythos Classic — Website Edition

A retro, browser-based 2D MMORPG prototype. **Players only need a web browser.** They do not install Node.js, download the game, or have administrator permission. Node.js runs only on the hosted server.

## Fastest way to put it on the internet

This project includes `render.yaml` for a hosted web service. You still need your own GitHub and hosting accounts; this workspace cannot publish a public website without you connecting those accounts.

1. Download `mythos-classic-website.zip` and unzip it.
2. Create a new GitHub repository at https://github.com/new . Give it a name like `mythos-classic`. Keep it private if you prefer.
3. Upload the contents of this folder into that repository. Upload the files and folders inside this folder, not the ZIP file itself.
4. Open https://render.com/ and sign in using GitHub.
5. Choose **New → Blueprint**, select your `mythos-classic` repository, and follow the prompts. Render reads `render.yaml` and sets up the hosted service.
6. Before launching for real, edit the `OWNER_EMAIL` value in `render.yaml` to your email address. Keep `OWNER_BOOTSTRAP_SECRET` private. Render generates this secret; copy it from the service environment settings when creating the owner account.
7. Wait for the deployment to finish, then open the `onrender.com` website address Render gives you.
8. Create your owner account with the exact email configured in `OWNER_EMAIL` and the private `OWNER_BOOTSTRAP_SECRET`. Use a strong password.
9. Create a separate player account to test normal gameplay.

**Hosting note:** This blueprint uses a small paid web service and a persistent disk because accounts are saved to a file. Check the host's current pricing before deploying. The included file-based account store is for a small prototype; a larger public MMO should use a managed database and stronger production hardening.

## What's in the website

- Sign-in and account creation
- Retro HTML5 Canvas world with movement and click-to-move
- Monsters, gathering, starter quest, inventory, skills, and character save requests
- Multiplayer sockets and chat
- Owner-only administration panel for live sessions and world controls
- One hosted web address for the browser client, API, and real-time sockets

## Local developer preview (not needed by players)

A developer can test it on a computer with Node.js 20+:

```bash
npm run install:all
npm run build
```

Create `backend/.env` based on `backend/.env.example`, then run `npm start`. For local development, the Vite frontend can be run separately with `npm run dev:frontend`.

## Important limitations

This is an early MMORPG prototype, not a finished commercial MMO. Gameplay validation, persistent-world architecture, anti-cheat protections, backups, moderation tools, accessibility testing, and load testing need more work before a large public release. Public/library networks may block game sites or real-time connections, which the game owner cannot override.
