# Qalam — exact setup instructions

You don't need to know how to code to run this. Follow these steps in
order and you'll have a working website with a real address you can share.

## Part 1: Put the site online (using Render, free)

Render will run your site 24/7, install everything it needs automatically,
and give you a real web address (like `qalam.onrender.com`).

**Step 1 — Create a GitHub account** (skip if you already have one)
Go to github.com and sign up. It's free.

**Step 2 — Create a new repository**
- Click the "+" in the top right → "New repository"
- Name it `qalam`
- Leave everything else as default → click "Create repository"

**Step 3 — Upload the files**
- On the new repository's page, click "uploading an existing file"
- Drag in everything: `server.js`, `package.json`, `README.md`, and the
  `public` folder (with `index.html` and `admin.html` inside it)
- Click "Commit changes" at the bottom

**Step 4 — Create your Render account**
Go to render.com → sign up (signing up directly with your GitHub account
is the easiest option)

**Step 5 — Create the web service**
- On Render, click "New +" → "Web Service"
- Connect your GitHub account if asked, then select the `qalam` repository
- Render will detect this is a Node project. Set:
  - **Name**: anything you like, e.g. `qalam`
  - **Build Command**: `npm install`
  - **Start Command**: `npm start`
  - **Instance Type**: Free
- Before clicking create, scroll to "Environment Variables" and add two:
  - Key: `ADMIN_PASSWORD` → Value: a password only you know (write it down)
  - Key: `SESSION_SECRET` → Value: any long random string, e.g. mash your
    keyboard for 30 characters — this just needs to be unpredictable, you
    won't need to remember it
- Click "Create Web Service"

Render will install everything and start your site. After a few minutes,
it'll show a URL like `https://qalam-xxxx.onrender.com` — that's your live
website.

**One thing to know about the free tier**: Render's free plan "sleeps" the
site after 15 minutes of no visitors, so the first visitor after a quiet
period waits about 30-50 seconds for it to wake up. Everyone after that
loads normally until it goes quiet again. Fine for testing and early use;
Render's paid tier ($7/mo) removes the sleep if it matters later.

## Part 2: Approving freelancers

Once someone signs up as a freelancer, they won't show up publicly until
you approve them.

1. Go to `https://your-site-address.onrender.com/admin.html`
2. Enter the `ADMIN_PASSWORD` you set in Step 5 above
3. You'll see anyone waiting for approval, with their info — click
   "Approve" to make them visible to clients. "Revoke" undoes it later
   if needed.

Keep that admin page address and password private — anyone with the
password can approve or revoke freelancer profiles.

## What the site currently does

- Anyone can sign up as a client (to post jobs) or a freelancer (to find work)
- Passwords are never stored in plain text
- Freelancers are hidden from public view until you approve them on the
  admin page
- Clients can post jobs; verified freelancers can apply (once per job)
- Clients can see who applied to their jobs
- Login/signup/admin-login are all rate-limited, so someone can't hammer
  them with repeated automated attempts
- All form input is checked on the server (valid email, minimum password
  length, required fields) — not just in the browser, which is what
  actually matters for security
- No money, banking details, or payment information is collected anywhere

## A note on how this was built and tested

This version uses Express (a standard, widely-used Node.js web framework)
plus `express-session` for login and `express-rate-limit` for abuse
protection — the same libraries used in most real-world small Node apps,
so this isn't unusual or experimental territory.

One honest caveat: the sandbox this was built in has no internet access,
so `npm install` couldn't be run there to do a live end-to-end test the
way earlier versions of this project were tested. The code was checked
for syntax errors and follows the standard, well-documented patterns for
these libraries, but the very first real run of the full install-and-start
process will happen on Render. If anything goes wrong there, Render's
"Logs" tab will show the actual error — send it to me and I'll fix it
immediately.

## If something breaks

If the site won't load after deploying:
- On Render, click your service → "Logs" — this shows the actual error
- Paste that error to me and I'll tell you exactly what's wrong and how
  to fix it

You will not need to touch code for normal use of the site — code changes
are only needed if we're adding a new feature or fixing something.

## What's next (in order of what matters most)

1. **Confirm the first deploy works** — this is the first time this exact
   code runs for real, so this is worth checking carefully before
   anything else
2. **Payments** — needs real research into which payment partner can
   actually serve Afghanistan, since standard options don't
3. **Messaging** between client and freelancer after an application is accepted
4. **A proper database** (the current one is a simple file — fine for now,
   worth upgrading once you have more than a handful of users)

Just tell me when you want to tackle any of these, or if the first deploy
hits a snag — I'll walk through it with you.
