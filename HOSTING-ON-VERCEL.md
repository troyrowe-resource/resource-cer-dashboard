# Hosting this dashboard on Vercel - a plain guide

This gets your dashboard live on the internet in about ten minutes. It assumes you have a
GitHub account and a Vercel account but have never deployed a site before. No coding needed.

Jargon, once: **GitHub** stores your code online. **Vercel** is the host that turns that code
into a live website and rebuilds it whenever the code changes. **Deploy** just means "publish".

---

## 1. Get the code onto GitHub

You need the project folder (`resource-cer-dashboard`) in a GitHub repository ("repo" = a
project folder that lives on GitHub).

1. On github.com, click **New** (top left, green button) to make a new repository. Name it
   `resource-cer-dashboard`. Leave it empty (do not add a README). Click **Create repository**.
2. On your computer, open a terminal **in the project folder** and run these commands, one at a
   time. Replace `YOUR-USERNAME` with your GitHub username:

```bash
git init
git add .
git commit -m "ReSource solar and battery dashboard"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/resource-cer-dashboard.git
git push -u origin main
```

That uploads everything (including the CER data files, which are meant to be included). If a
local git repository already exists, you only need the last three commands.

---

## 2. Connect the repo to Vercel

1. Go to vercel.com and sign in (use "Continue with GitHub" so the two are linked).
2. Click **Add New...** then **Project**.
3. Find `resource-cer-dashboard` in the list and click **Import**.
4. Vercel detects it is a **Next.js** app and fills in all the build settings for you.
   **Leave everything on the defaults.** You do not need to set any environment variables, and
   you do not need to change the build command - the data files are rebuilt automatically on
   every deploy.
5. Click **Deploy**.

---

## 3. The first deploy

Vercel installs the project, rebuilds the data from the CER files, and publishes the site. This
takes roughly **two to four minutes** the first time. When it finishes you get a live URL that
looks like `https://resource-cer-dashboard.vercel.app` - click it to see the dashboard. That URL
works immediately and is yours to share.

---

## 4. Put it on a ReSource subdomain (like the B-Cycle map)

To serve it at something like `solar-map.re-source.au`:

1. In Vercel, open the project, go to **Settings** then **Domains**.
2. Type `solar-map.re-source.au` and click **Add**. Vercel will show you a DNS record to create
   - it will be a **CNAME** pointing to something like `cname.vercel-dns.com`. (A CNAME is just a
   signpost that points one web address at another.)
3. Log in to **GoDaddy**, open the DNS settings for `re-source.au`, and add a new record:
   - **Type:** CNAME
   - **Name / Host:** `solar-map`
   - **Value / Points to:** the value Vercel gave you (e.g. `cname.vercel-dns.com`)
   - **TTL:** leave the default (1 hour)
   Save it.
4. Back in Vercel the domain goes green within a few minutes to an hour (DNS can be slow). Once
   it does, `https://solar-map.re-source.au` shows the dashboard, with HTTPS set up for you.

---

## 5. The monthly data update (your routine)

Each month the Clean Energy Regulator publishes fresh figures. To update the live dashboard:

1. Download the two latest files from the CER page (the "2011 to present" Installations and
   Capacity workbooks):
   <https://cer.gov.au/markets/reports-and-data/small-scale-installation-postcode-data>
2. In the project's `data/cer/` folder, replace these two files with the new ones, **keeping the
   exact same filenames**:
   - `sres-postcode-data-installations-2011-to-present-and-totals.xlsx`
   - `sres-postcode-data-capacity-2011-to-present-and-totals.xlsx`
   Leave the two `...-2001-to-2010.xlsx` files alone - they are fixed history and do not change.
3. Commit and push the change:

```bash
git add data/cer
git commit -m "Update CER data"
git push
```

4. That is it. Vercel sees the change, rebuilds, re-reads the files, and redeploys automatically
   within a couple of minutes. The "data as at" date and the new month appear on their own - no
   other changes needed.

---

## 6. If something goes wrong

**Where to look:** in Vercel, open the project, click the **Deployments** tab, click the most
recent deployment, and read the **Build Logs**. The error is almost always near the bottom.

The two most likely problems, and what they mean:

- **"Missing CER file" or a filename error.** The CER renamed a file. Open
  `scripts/build-data.ts`, find the `CONFIG` block at the very top, and update the filename(s)
  there to match the new ones. Commit and push.

- **"RECONCILIATION FAILED" or "INTEGRITY CHECK FAILED".** The new file is structured
  differently from before and the safety checks caught it. **Do not try to force it through** -
  this is the system protecting you from publishing wrong numbers. Leave the previous version
  live and flag it (to me, or whoever maintains this) so the parser can be adjusted to the new
  format.

**Rolling back (undo a bad deploy in one click):** in the **Deployments** tab, find the last
deployment that worked, click the **...** menu next to it, and choose **Promote to Production**
(or **Rollback**). The site instantly reverts to that working version while you sort out the
problem. Nothing is lost.

---

That is everything. Day to day you only ever touch section 5.
