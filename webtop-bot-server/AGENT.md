# Instructions for the setup agent

You are setting up **webtop-bot** for a parent on a free Oracle Cloud server. When you are done, three Telegram bots, one per child, send school updates (homework, messages, discipline, daily summary) 24/7, even when the parent's computer is off.

Rules:
- Everything must stay **free**. Use only resources labelled **Always Free**. Never click "Upgrade to Pay As You Go" or any paid shape.
- **The parent types the credit card details themselves.** Oracle uses the card only to verify identity and does not charge it. Stop and hand over to the parent at that step.
- Children's WEBTOP usernames and passwords: ask the parent for them only at step 5. Type them straight into the server prompt and never save them to a file on this computer.
- Talk to the parent in Hebrew.

## Step 1: Create the three Telegram bots
1. Open https://web.telegram.org in Chrome. The parent must be logged in.
2. Open a chat with **@BotFather** and send `/newbot`. Use a display name such as `WEBTOP <child name>` and a unique username ending in `bot`.
3. Do this three times, once per child. Note each **token** (format `123456:ABC...`) and **bot username** so you can use them in the next steps.

## Step 2: Create the Oracle Cloud account
1. Open https://www.oracle.com/cloud/free/ and click **Start for free**.
2. Fill in the parent's details. As **Home Region**, choose **Israel Central (Jerusalem)**. It cannot be changed later, and an Israeli server is the most reliable for WEBTOP.
3. At the payment verification step, **stop and ask the parent to enter the card details themselves.** Oracle may place a temporary hold of about $1, which is refunded.
4. Wait until the account is ready. The console opens at https://cloud.oracle.com.

## Step 3: Get the cloud-init file
Open this file in the browser (the parent's GitHub login may be needed) and copy its **entire raw content**:
https://github.com/itzikelisha89/rouel-stars/blob/claude/modest-archimedes-ir7bm6/webtop-bot-server/cloud-init.yaml
(Use the "Raw" button, then Ctrl+A, Ctrl+C.)

## Step 4: Create the server
In the Oracle console, go to **Compute → Instances → Create instance**:
1. Name: `webtop-bot`.
2. **Image and shape → Edit:**
   - Image: **Canonical Ubuntu 24.04** (not Minimal).
   - Shape: **VM.Standard.E2.1.Micro** (labelled "Always Free-eligible").
3. **Networking:** keep the defaults (create a new VCN and public subnet, assign a public IPv4 address).
4. **Add SSH keys:** choose **Generate a key pair for me** and click **Save private key**. The file goes to Downloads, for example `ssh-key-2026-xx-xx.key`.
5. **Show advanced options → Management → Initialization script → Paste cloud-init script:** paste the content you copied in step 3.
6. Click **Create**. Wait until the state is **Running**, then copy the **Public IP address**.
7. Wait another **5–7 minutes** for the automatic installation to finish.

If you get "Out of capacity", try again a few minutes later or pick another Availability Domain. Never choose a paid shape.

## Step 5: Connect and add the children
Open **PowerShell** on this computer:

```powershell
cd $HOME\Downloads
icacls .\ssh-key-*.key /inheritance:r /grant:r "$($env:USERNAME):R"
ssh -i .\ssh-key-*.key ubuntu@<PUBLIC_IP>
```
Answer `yes` to the fingerprint question.

Check that the installation finished. The command must print the file name; if not, wait a minute and try again:
```bash
ls /opt/webtop-bot/INSTALL_DONE
```

Add each child. Use simple English names, for example `kid1`, `kid2`, `kid3`:
```bash
sudo add-kid kid1
```
The script asks four questions:
1. **Telegram bot token:** this child's token from step 1.
2. **WEBTOP username:** ask the parent.
3. **WEBTOP password:** ask the parent, or let them type it. It is not shown on screen.
4. **Allowed chat IDs:** leave **empty** for now and press Enter.

Repeat for `kid2` and `kid3`.

## Step 6: Allow the parent's Telegram
1. In Telegram Web, open each child's bot, press **Start** and send `/myid`. The bot replies with a number. It is the same number for all three bots.
2. If the second parent should also get updates, they send `/myid` from their own Telegram and give you their number.
3. On the server:
```bash
sudo allow-chat kid1 <ID>[,<ID2>]
sudo allow-chat kid2 <ID>[,<ID2>]
sudo allow-chat kid3 <ID>[,<ID2>]
```

## Step 7: Verify
1. Send `/start` to each bot in Telegram. A Hebrew menu should appear. Tap the schedule or homework option and check that real school data appears.
2. On the server, check that all three are running:
```bash
systemctl is-active webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3
```
All three must print `active`.
3. If a bot does not answer or shows a login error, collect its log and show it to the parent:
```bash
journalctl -u webtop-bot@kid1 -n 50 --no-pager
```

## Step 8: Hand over
Tell the parent, in Hebrew:
- The server IP and the location of the SSH key file (keep it safe; it is the only way into the server).
- What arrives automatically: new homework, messages and discipline every 10 minutes, a daily summary at 17:00, and tomorrow's schedule at 19:00.
- To update the bot later, run `sudo webtop-update` on the server.

Then type `exit` to leave the server.
