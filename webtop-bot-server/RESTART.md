# Restart the bot after the WEBTOP block was lifted

The Ministry of Education lifted the block on the server and asked that the bot **not check every 10 minutes**. This version checks each child **every 30 minutes**, with the children 5 minutes apart. Install it, test **one child once**, and only then start everyone.

Speak to the parent in Hebrew. Run commands exactly as written.

## Step 1: Connect to the server
In Windows PowerShell:
```powershell
cd $HOME\Downloads
$key = (Get-ChildItem ssh-key-*.key | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
ssh -i $key ubuntu@<PUBLIC_IP>
```
If you don't know the IP, find it in the Oracle console under Compute → Instances → webtop-bot → Public IP address.

## Step 2: Make sure nothing is running for the children
```bash
sudo systemctl stop webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3
```

## Step 3: Install the 30-minute version and the check tool
```bash
R=https://raw.githubusercontent.com/itzikelisha89/rouel-stars/8eaa592ac2dc07cb23ead5a1a274bdfa66b7d810/webtop-bot-server
sudo curl -fsSL $R/lib/kid_worker.py -o /opt/webtop-bot/lib/kid_worker.py
sudo curl -fsSL $R/lib/router.py -o /opt/webtop-bot/lib/router.py
sudo curl -fsSL $R/lib/check_login.py -o /opt/webtop-bot/lib/check_login.py
sudo curl -fsSL $R/webtop-check.sh -o /usr/local/sbin/webtop-check
sudo chmod 755 /usr/local/sbin/webtop-check
grep -c "POLL_MINUTES" /opt/webtop-bot/lib/kid_worker.py
```
The last command must print a number greater than 0. If it prints `0` or an error, stop and show the parent.

## Step 4: Test one child, once
```bash
sudo webtop-check kid1
```
- **`OK: signed in as ...`**: continue to step 5.
- **`BLOCKED`**: the block is still active. Stop the children (`sudo systemctl stop webtop-bot@kid1`), do not try again, and show the parent the output.
- **`REFUSED`**: wrong username or password for this child. Show the parent the output, then follow step 4 of `FIX-LOGIN.md` in the same folder.

## Step 5: Start the children, 5 minutes apart
```bash
sudo systemctl enable --now webtop-router webtop-bot@kid1
```
Wait 5 minutes, then:
```bash
sudo webtop-check kid2 && sudo systemctl enable --now webtop-bot@kid2
```
Wait 5 minutes, then:
```bash
sudo webtop-check kid3 && sudo systemctl enable --now webtop-bot@kid3
```
If kid2 or kid3 shows `REFUSED`, it is that child's password: follow step 4 of `FIX-LOGIN.md` for that child only.

## Step 6: Verify
```bash
systemctl is-active webtop-router webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3
journalctl -u webtop-bot@kid1 -n 20 --no-pager -o cat | grep -E "interval|login|Login"
```
- The first command must print `active` four times.
- The log should mention `interval[0:30:00]` and `Webtop login succeeded`. It must not show `BLOCKED`, `403` or `Login failed`.

Then send `/start` to the bot in Telegram. It should list the three children and say "תוך כ-30 דקות".

## Step 7: Report to the parent, in Hebrew
- Which children show OK.
- That new homework, messages and discipline events arrive within about 30 minutes, the daily summary at 17:00, and tomorrow's schedule at 19:00.
- The first check after starting only records what already exists, so the first alerts are only for new items.
- If anything failed, the full output.

Then type `exit`.
