# Fix: WEBTOP blocks the server (BLOCKED)

`sudo webtop-check` showed `BLOCKED` for all children, but the same server could sign in on 12/11. The block most likely came from too many sign-in attempts from one address, and blocks like that usually expire once the attempts stop. So: stop the bots, install a gentler version, wait, and check **once**.

Speak to the parent in Hebrew. **Do not** change the server's IP address and do not try other ways around the block. Only stop the bots, wait, and check.

## Part A: do now
Connect to the server the same way as before (PowerShell → `ssh -i $key ubuntu@<PUBLIC_IP>`), then run exactly:

1. Stop the three children so that no requests reach WEBTOP:
```bash
sudo systemctl stop webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3
sudo systemctl disable webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3
```

2. Install the gentler version. It checks every 30 minutes instead of 10, and starts the children 5 minutes apart:
```bash
R=https://raw.githubusercontent.com/itzikelisha89/rouel-stars/8eaa592ac2dc07cb23ead5a1a274bdfa66b7d810/webtop-bot-server
sudo curl -fsSL $R/lib/kid_worker.py -o /opt/webtop-bot/lib/kid_worker.py
sudo curl -fsSL $R/lib/router.py -o /opt/webtop-bot/lib/router.py
sudo systemctl restart webtop-router
```

3. Make sure nothing is running for the children:
```bash
systemctl is-active webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3
```
All three must say `inactive`.

4. Type `exit`. Tell the parent: "עצרתי את הבוטים. צריך לחכות 24 שעות בלי שום ניסיון כניסה, ואז להריץ את חלק ב'."

**Do not run `webtop-check` during the wait.** Every attempt can extend the block.

## Part B: do 24 hours later
Connect to the server and check **only one child, once**:
```bash
sudo webtop-check kid1
```

- **`OK: signed in as ...`**: the block has expired. Start the children:
  ```bash
  sudo systemctl enable --now webtop-bot@kid1
  sudo systemctl enable --now webtop-bot@kid2
  sudo systemctl enable --now webtop-bot@kid3
  ```
  Tell the parent that the bot is working again. The first check after starting only records what already exists, and alerts begin after that.

- **`BLOCKED`**: the block did not expire. Do not try again. Leave the bots stopped. Show the parent the output and tell them it must go back to the engineer.

- **Anything else** (for example `REFUSED`): show the parent the full output.
