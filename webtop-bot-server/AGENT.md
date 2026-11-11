# Instructions for the setup agent

You are setting up **webtop-bot** for a parent on a free Oracle Cloud server. When you are done, **one Telegram bot** sends school updates for **three children** 24/7, even when the parent's computer is off. Every message starts with the child's name.

You have Chrome on the parent's computer. Telegram Web is already logged in there.

## Rules
- Everything must stay **free**. Use only resources labelled **Always Free**. Never click "Upgrade", "Pay As You Go" or any paid shape.
- **The parent types the credit card details themselves.** Oracle uses the card only to verify identity and does not charge it. Stop and hand over to the parent at that step.
- Ask the parent for the children's WEBTOP usernames and passwords only at step 6. Type them straight into the server prompt. Never save them in a file, a note or a chat.
- Speak to the parent in Hebrew. Report briefly after each step.

## Step 1: Create the one Telegram bot
1. Open https://web.telegram.org/k/ and search for **@BotFather** (the one with the blue verified tick).
2. Send `/newbot`.
3. Name: `WEBTOP הבית`.
4. Username: something unique ending in `bot`, for example `webtop_home_<4 random digits>_bot`. If it is taken, try another.
5. BotFather replies with a **token** like `1234567890:AAH...`. Keep it for step 5; don't paste it anywhere else.

## Step 2: Create the Oracle Cloud account
1. Open https://signup.cloud.oracle.com/
2. Fill in the parent's details. Account type: **Personal**.
3. **Home Region: Israel Central (Jerusalem).** It cannot be changed later.
4. At the payment verification step, **stop and ask the parent to enter the card themselves**. A temporary hold of about $1 may appear and is released.
5. Wait until the account is ready and the console opens at https://cloud.oracle.com. This can take a few minutes. Sign in if asked.

## Step 3: Copy the install file
Open this URL and copy **all** of its text (Ctrl+A, Ctrl+C):
https://raw.githubusercontent.com/itzikelisha89/rouel-stars/claude/modest-archimedes-ir7bm6/webtop-bot-server/cloud-init.yaml

The first line must be `#cloud-config`.

## Step 4: Create the server
In the Oracle console, open the menu ☰ and go to **Compute → Instances**, then click **Create instance**.
1. Name: `webtop-bot`.
2. **Image and shape → Edit**:
   - **Change image → Ubuntu → Canonical Ubuntu 24.04** (not "Minimal"), then click Select.
   - **Change shape → Specialty and previous generation → VM.Standard.E2.1.Micro** (marked "Always Free-eligible"), then click Select.
     If that shape is not offered, use **Ampere → VM.Standard.A1.Flex** with 1 OCPU and 6 GB memory, which is also Always Free.
3. **Networking**: keep the defaults (new virtual cloud network and public subnet). Make sure **Assign a public IPv4 address** is on.
4. **Add SSH keys**: select **Generate a key pair for me** and click **Save private key**. The file is saved to Downloads.
5. Click **Show advanced options → Management** tab, choose **Paste cloud-init script**, and paste the text from step 3.
6. Click **Create**.
7. Wait until the state is **Running** and copy the **Public IP address**.
8. Wait **10 more minutes**. The server installs everything by itself.

If you see "Out of capacity", choose a different Availability Domain (AD-1/2/3) under Placement, or retry in 10 minutes. Never pick a paid shape.

## Step 5: Connect to the server and set the bot
Open **Windows PowerShell** (not as admin) and run:

```powershell
cd $HOME\Downloads
$key = (Get-ChildItem ssh-key-*.key | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
icacls $key /inheritance:r /grant:r "$($env:USERNAME):R"
ssh -i $key ubuntu@<PUBLIC_IP>
```
Type `yes` when asked about the fingerprint.

On the server, check that the installation finished:
```bash
ls /opt/webtop-bot/INSTALL_DONE
```
If you get "No such file", wait 2 minutes and try again. If it is still missing after 20 minutes, run `sudo tail -30 /var/log/cloud-init-output.log` and show the parent.

Set the bot:
```bash
sudo set-bot
```
Paste the token from step 1. The command must print `active`.

## Step 6: Add the three children
For each child, run the command below with `kid1`, then `kid2`, then `kid3`:
```bash
sudo add-kid kid1
```
It asks three things:
1. **Child's name as it should appear in messages:** ask the parent (in Hebrew, for example נועה).
2. **WEBTOP username:** ask the parent.
3. **WEBTOP password:** ask the parent, or let them type it. It is not shown on screen.

After each child, the last lines must not contain `Login failed`, `401` or `Invalid`. If they do, the username or password is wrong: run the same `add-kid` command again.

## Step 7: Connect the parent's Telegram to the bot
1. In Telegram Web, open the new bot (search for its username from step 1), click **Start**, or send `/start`.
2. The bot replies `המספר שלך: <number>`. Copy that number.
3. If the second parent should also get updates, they send `/start` to the bot from their own Telegram and tell you their number.
4. On the server:
```bash
sudo allow-chat <NUMBER>
```
For two parents: `sudo allow-chat <NUMBER1>,<NUMBER2>`.
5. Send `/start` to the bot again. It must now reply `✅ הבוט פעיל ושולח עדכונים אוטומטיים על:` followed by the three names.

## Step 8: Verify
```bash
systemctl is-active webtop-router webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3
```
All four lines must say `active`. Check each child's log for errors:
```bash
journalctl -u webtop-bot@kid1 -n 30 --no-pager -o cat
```
Repeat for kid2 and kid3.

Lines with `Notifier initialized` or `executed successfully` are good. If you see repeated `Login failed` or `401`, run that child's `add-kid` again with the correct password.

The first check runs about one minute after start and records what already exists without sending anything. From then on, only **new** items are sent.

## Step 9: Hand over
Type `exit` to leave the server. Tell the parent, in Hebrew:
- The server is running for free on Oracle (Always Free) in Jerusalem, and the computer can be turned off.
- One bot sends, for all three children:
  - new homework, messages and discipline events within about 10 minutes;
  - a daily summary at 17:00;
  - tomorrow's schedule at 19:00.
- Each message starts with 🎒 and the child's name.
- The SSH key file in Downloads is the only way into the server. Keep it safe and don't share it.
- Useful commands, run on the server after connecting with the same `ssh` command:
  - `sudo allow-chat <ids>` changes who gets the updates.
  - `sudo add-kid kid1` changes a child's password.
  - `sudo webtop-update` updates the bot.
