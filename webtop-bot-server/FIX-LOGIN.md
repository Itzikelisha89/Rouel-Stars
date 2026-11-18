# Fix: the bot cannot sign in to the children's WEBTOP accounts

You are the parent's setup agent. The server from `AGENT.md` is already running. Find out exactly why the WEBTOP sign-in fails, fix what can be fixed, and report the result. Speak to the parent in Hebrew.

## Step 1: Connect to the server
In Windows PowerShell:
```powershell
cd $HOME\Downloads
$key = (Get-ChildItem ssh-key-*.key | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
ssh -i $key ubuntu@<PUBLIC_IP>
```
(The public IP is on the instance page at https://cloud.oracle.com under Compute → Instances.)

## Step 2: Install the diagnostic tool
Run these on the server exactly as written:
```bash
R=https://raw.githubusercontent.com/itzikelisha89/rouel-stars/dad2139577dddf739c9a48d213081919e29d78bc/webtop-bot-server
sudo curl -fsSL $R/lib/check_login.py -o /opt/webtop-bot/lib/check_login.py
sudo curl -fsSL $R/webtop-check.sh -o /usr/local/sbin/webtop-check
sudo chmod 755 /usr/local/sbin/webtop-check
```

## Step 3: Run the check
```bash
sudo webtop-check
```
It tries one sign-in for each child. Copy the **whole output** and show it to the parent. Then act on each child's result line:

| Result line starts with | Meaning | What to do |
|---|---|---|
| `OK: signed in as ...` | Works. The retry wait was cleared and the child restarted. | Nothing. Alerts start within about 10 minutes. |
| `BLOCKED:` | The WEBTOP site refuses this server's address. The password was never checked. | **Stop.** Do not change anything. Tell the parent exactly this output and that the engineer (Claude) needs to see it. |
| `REFUSED:` with `WEBTOP said: ... status: False` | WEBTOP rejected the username or password. | Go to step 4 for that child. |
| `REFUSED: WEBTOP requires interactive verification or a password update` | The account needs a one-time action on the website. | Go to step 5 for that child. |
| `TOO MANY ATTEMPTS` | Rate limited. | Wait 30 minutes, then run `sudo webtop-check <kidN>` once. |
| `NETWORK:` or anything else | Unknown. | Stop and show the parent the output. |

## Step 4: Check the username and password in Chrome
1. Open a **new incognito window** in Chrome and go to https://webtop.smartschool.co.il
2. With the parent, sign in using **"כניסה עם שם משתמש וסיסמה"** (username and password). **Not** "הזדהות משרד החינוך" (Ministry of Education login).
3. Possible outcomes:
   - **It works:** the username and password are correct. Sign out, and on the server run `sudo add-kid <kidN>` to enter them again carefully. Watch for Hebrew/English keyboard mix-ups and extra spaces. Then run `sudo webtop-check <kidN>`.
   - **It fails:** the child has no WEBTOP password, or it is different. The parent can set one: sign in with "הזדהות משרד החינוך", then go to the profile/settings page and set a WEBTOP username and password. Or ask the school. After that, run `sudo add-kid <kidN>` with the new password and `sudo webtop-check <kidN>`.
   - **The child only ever signs in with the Ministry of Education login:** tell the parent that the bot needs a WEBTOP username and password, and that one has to be set as described above.

## Step 5: One-time action on the website
Sign in at https://webtop.smartschool.co.il in Chrome with that child's username and password. Complete whatever the site asks for: a verification code, a password change, or accepting terms. If the password was changed, run `sudo add-kid <kidN>` with the new password. Then run:
```bash
sudo webtop-check <kidN>
```

## Step 6: Report
Run once more:
```bash
sudo webtop-check
```
Show the parent the full output. If every child shows `OK`, tell them, in Hebrew, that the bot is working and alerts will arrive. If anything still fails, give them the full output to send to the engineer.
