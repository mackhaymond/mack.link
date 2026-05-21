# 🚀 Setup Guide - Deploy Your Own Mack.link

Deploy your own URL shortener in **under 10 minutes**! This guide will walk you through setting up your own Mack.link instance on Cloudflare's free tier.

## ✅ What You'll Need

- **GitHub account** (for authentication)
- **Cloudflare account** ([sign up free](https://dash.cloudflare.com/sign-up))
- **Node.js 18+** ([download here](https://nodejs.org/))
- **Custom domain** (optional but recommended)

## 📦 Step 1: Get the Code

1. **Fork this repository** by clicking the "Fork" button at the top of this page
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/mack.link.git
   cd mack.link
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```

## 🔑 Step 2: Setup GitHub Authentication

Your URL shortener will use GitHub for secure login. Let's create an OAuth app:

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in the details:
   - **Application name**: `Your Name's Link Shortener`
   - **Homepage URL**: `https://YOUR_DOMAIN.com` (or use `https://worker-name.YOUR_USERNAME.workers.dev` if you don't have a domain)
   - **Authorization callback URL**: `https://YOUR_DOMAIN.com/admin/auth/callback`
4. Click **"Register application"**
5. **Save your Client ID and Client Secret** - you'll need these next!

## ⚙️ Step 3: Configure Your Worker

1. **Edit the worker configuration**:
   ```bash
   # Open worker/wrangler.jsonc in your editor
   nano worker/wrangler.jsonc
   ```

2. **Update the configuration**:
   ```json
   {
     "name": "my-link-shortener",  // Choose a unique name
     "vars": {
       "GITHUB_CLIENT_ID": "your_github_client_id_here",
       "AUTHORIZED_USER": "your_github_username",
       "SESSION_COOKIE_NAME": "__Host-link_session",
       "SESSION_MAX_AGE": "28800"
     }
   }
   ```

## 🗄️ Step 4: Setup Database & Secrets

1. **Login to Cloudflare via Wrangler**:
   ```bash
   npx wrangler login
   ```

2. **Create and setup the database**:
   ```bash
   # Create D1 database (note the database ID returned - you'll need it)
   npx wrangler d1 create mack-link
   
   # Update worker/wrangler.jsonc with the database ID from above
   # Apply the database schema
   npx wrangler d1 execute mack-link --file=worker/src/schema.sql
   ```

3. **Add your GitHub secrets securely**:
   ```bash
   # Add GitHub client secret
   echo "your_github_client_secret" | npx wrangler secret put GITHUB_CLIENT_SECRET
   
   # Add JWT secret (use a random string)
   echo "$(openssl rand -base64 32)" | npx wrangler secret put JWT_SECRET
   ```

   > 💡 **Tip**: If you don't have `openssl`, just use any random 32+ character string for JWT_SECRET

## 🚀 Step 5: Deploy!

```bash
npm run deploy
```

## ✅ Step 6: Test Your Deployment

1. **Visit your admin panel**:
   - With custom domain: `https://yourdomain.com/admin`
   - Without custom domain: `https://worker-name.YOUR_USERNAME.workers.dev/admin`

2. **Sign in with GitHub** and create your first short link!

3. **Test the redirect** by visiting your short link

## 🎉 You're Done!

Congratulations! Your URL shortener is now live. Here's what you can do next:

### 🔧 Customize Your Instance

**Set up a custom domain**:
- Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
- Navigate to **Workers & Pages** → Your worker → **Settings** → **Triggers**
- Click **Add Custom Domain** and follow the instructions

**Change the authorized user**:
```bash
# Edit worker/wrangler.jsonc
"AUTHORIZED_USER": "new_github_username"

# Redeploy
npm run deploy
```

**Add organization access**:
```bash
# Allow any member of your GitHub organization
"AUTHORIZED_USER": "@your-org-name"
```

**Custom branding**:
- Replace `admin/public/favicon.jpg` with your logo
- Update colors in `admin/tailwind.config.js`
- Modify the app name in `admin/index.html`

## 🔧 Advanced Configuration

### Multi-User Access
You can allow multiple users or entire GitHub organizations:

```json
{
  "vars": {
    "AUTHORIZED_USER": "@your-org-name",  // Allow entire organization
    // OR for multiple specific users:
    "AUTHORIZED_USERS": "user1,user2,user3"
  }
}
```

### Custom Session Settings
```json
{
  "vars": {
    "SESSION_MAX_AGE": "86400",  // 24 hours in seconds
    "SESSION_COOKIE_NAME": "__Host-link_session"
  }
}
```

## 🚨 Security Best Practices

- ✅ **Never commit secrets to Git** - always use `wrangler secret put`
- ✅ **Use strong JWT secrets** - at least 32 random characters
- ✅ **Regularly rotate GitHub OAuth secrets**
- ✅ **Monitor usage** in Cloudflare Dashboard
- ✅ **Use custom domains** for production deployments
- ✅ **Enable Cloudflare security features** (firewall, rate limiting)

## 🆘 Troubleshooting

### Common Issues

**❌ OAuth not working**: 
- Check callback URLs match exactly: `https://yourdomain.com/admin/auth/callback`
- Verify GitHub Client ID is correct in `wrangler.jsonc`

**❌ "Access Denied" error**:
- Check `AUTHORIZED_USER` matches your GitHub username exactly
- Make sure you're signed into the correct GitHub account

**❌ Worker not deploying**: 
- Run `npx wrangler login` to authenticate
- Check your Cloudflare account has Workers enabled

**❌ Database errors**: 
- Verify D1 database binding in `wrangler.jsonc`
- Check database ID matches the one created
- Ensure schema was applied: `npx wrangler d1 execute mack-link --file=worker/src/schema.sql`

**❌ "TypeError: Cannot read properties of undefined"**:
- Usually means environment variables aren't set correctly
- Check all required secrets are added via `wrangler secret put`

### Getting Help

If you're still having issues:

1. **Check the logs**: `npx wrangler tail` to see real-time errors
2. **Verify configuration**: Double-check all URLs and secrets
3. **Test locally**: Use `npm run dev` to test before deploying
4. **Community support**: [Open an issue](https://github.com/mackhaymond/mack.link/issues) with detailed error messages

## 📊 Monitoring Your Instance

### Cloudflare Dashboard
Monitor your shortener's performance:
- **Workers & Pages** → Your worker → **Metrics**
- View request volume, error rates, and response times
- Set up alerts for high error rates

### Built-in Analytics
Your admin panel includes:
- 📈 Click tracking and trends
- 🌍 Geographic and device breakdowns  
- 🔗 Top performing links
- 📊 UTM parameter tracking

## 🔄 Updates & Maintenance

### Keeping Your Instance Updated
```bash
# Sync with upstream changes
git remote add upstream https://github.com/mackhaymond/mack.link.git
git fetch upstream
git merge upstream/main

# Redeploy with latest changes
npm run deploy
```

### Regular Maintenance
- **Monitor database size** - D1 free tier has 5GB limit
- **Review access logs** for unusual activity
- **Update dependencies** periodically: `npm update`
- **Backup your data** if running a critical instance

---

## 🎯 What's Next?

Now that your URL shortener is running:

1. 📱 **Bookmark your admin panel** for easy access
2. 🔗 **Create your first links** and test the analytics
3. 🎨 **Customize the branding** to match your style  
4. 📊 **Set up monitoring** to track usage
5. 🚀 **Share it** with your team or audience!

---

*Need more help? Check the [Development Guide](./DEVELOPMENT.md) for local development setup or [open an issue](https://github.com/mackhaymond/mack.link/issues) for support.*