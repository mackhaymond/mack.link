# 📖 User Guide - Using Your Mack.link Shortener

Complete guide on how to use your Mack.link URL shortener admin interface.

## 🚀 Getting Started

### Accessing Your Admin Panel

1. **Visit your admin URL**: `https://yourdomain.com/admin`
2. **Sign in with GitHub**: Click the "Sign in with GitHub" button
3. **Authorize the app**: Grant permission if prompted

> 💡 **Tip**: Bookmark your admin panel for quick access!

### First Time Setup

After signing in for the first time:
1. You'll see an empty dashboard
2. Click **"Create New Link"** to make your first short URL
3. Test it by clicking the generated short link

## 🔗 Creating Short Links

### Basic Link Creation

1. **Click "Create New Link"** button
2. **Enter your long URL**: Any valid HTTP/HTTPS URL
3. **Choose a shortcode**: 
   - Leave blank for auto-generation
   - Or enter a custom code (letters, numbers, hyphens)
4. **Add description** (optional): Helps you remember what the link is for
5. **Click "Create Link"**

### Example
- **Long URL**: `https://github.com/mackhaymond/mack.link`
- **Custom Shortcode**: `github`
- **Description**: `My GitHub Repository`
- **Result**: `https://yourdomain.com/github`

## ⚙️ Advanced Link Options

### Password Protection
Protect sensitive links with a password:

1. **Toggle "Password Protection"** when creating/editing a link
2. **Enter a strong password**
3. **Save the link**

When visitors access the link, they'll need to enter the password first.

### Scheduled Links
Control when your links become active:

1. **Toggle "Schedule Link"** 
2. **Set "Activates At"**: When the link becomes available
3. **Set "Expires At"** (optional): When the link stops working

**Use Cases:**
- Event registration links that open at a specific time
- Temporary promotions with automatic expiry
- Time-sensitive announcements

### Redirect Types
Choose how your links redirect:

- **301 (Permanent)**: Best for SEO, tells search engines the redirect is permanent
- **302 (Temporary)**: Default option, good for most use cases
- **307/308**: Preserves HTTP method (advanced use)

## 📊 Analytics & Tracking

### Viewing Analytics

1. **Click the "Analytics" tab** in your admin panel
2. **Select time range**: Last 7 days, 30 days, or custom range
3. **Filter by link**: View stats for all links or specific ones

### What You Can Track

**Overview Metrics:**
- Total clicks and unique visitors
- Top performing links
- Traffic sources and referrers
- Geographic distribution

**Detailed Breakdowns:**
- **Countries**: Where your visitors are from
- **Devices**: Desktop vs mobile usage
- **Browsers**: Chrome, Safari, Firefox, etc.
- **Referrers**: Social media, direct visits, etc.

**UTM Tracking:**
If your links include UTM parameters (`?utm_source=twitter&utm_medium=social`), you'll see:
- Traffic sources (utm_source)
- Mediums (utm_medium) 
- Campaigns (utm_campaign)

### Charts and Trends
- **Time Series**: See click patterns over time
- **Real-time Updates**: Analytics refresh automatically
- **Export Data**: Download CSV reports for further analysis

## 🔧 Managing Your Links

### Editing Links

1. **Find your link** in the main dashboard
2. **Click the "Edit" button** (pencil icon)
3. **Make changes**: URL, description, password, etc.
4. **Save changes**

> ⚠️ **Note**: Changing the URL affects all existing short links immediately.

### Organizing Links

**Search and Filter:**
- Use the search box to find specific links
- Filter by creation date, click count, or status

**Bulk Operations:**
- **Bulk Import**: Upload CSV files with multiple links at once
- **Bulk Delete**: Select multiple links for deletion
- **Bulk Export**: Download all your links as CSV/JSON
- **Archive Links**: Hide old links without deleting them

**CSV Import Format:**
```csv
shortcode,url,description
github,https://github.com/your-repo,My Repository
twitter,https://twitter.com/you,My Twitter Profile
```

### QR Codes

Generate QR codes for any short link:

1. **Click the QR code icon** next to your link
2. **Customize appearance**: Size, colors, logo
3. **Download**: PNG, SVG, or PDF format

**Perfect for:**
- Print materials (flyers, business cards)
- Digital displays and presentations
- Easy mobile sharing

## 📱 Mobile Usage

Your admin panel works great on mobile devices:

- **Responsive design**: Optimized for phones and tablets
- **Touch-friendly**: Large buttons and easy navigation
- **Quick actions**: Create and edit links on the go

### Mobile Tips
- **Bookmark the admin page** on your phone's home screen
- **Use the search feature** to quickly find links
- **Share generated QR codes** directly from your phone

## 🎯 Best Practices

### Shortcode Naming
- **Keep it memorable**: Use relevant keywords
- **Avoid confusion**: Don't use similar codes like "event1" and "event2"
- **Brand consistency**: Use your brand name or abbreviations

### Link Organization
- **Use descriptions**: Always add meaningful descriptions
- **Regular cleanup**: Archive or delete old links
- **Monitor performance**: Check analytics regularly

### Security
- **Use passwords** for sensitive content
- **Set expiry dates** for time-limited content
- **Regular audits**: Review your links periodically

## 🔍 Troubleshooting

### Common Issues

**❓ "Link not found" errors:**
- Check if the shortcode was typed correctly
- Verify the link wasn't archived or deleted
- Ensure the link hasn't expired

**❓ Password prompts not working:**
- Clear browser cache and cookies
- Try in an incognito/private browser window
- Check if the password was recently changed

**❓ Analytics not updating:**
- Analytics update every 15 seconds
- Check your internet connection
- Try refreshing the page

**❓ Can't sign in:**
- Verify you're using the correct GitHub account
- Check if your account is authorized by the admin
- Clear browser cookies and try again

### Getting Help

If you're still having issues:

1. **Check the logs**: Your admin can view server logs
2. **Try incognito mode**: Rules out browser-specific issues
3. **Contact support**: Reach out with specific error messages

## 💡 Advanced Tips

### Keyboard Shortcuts
- **Ctrl/Cmd + N**: Create new link
- **Ctrl/Cmd + K**: Focus search
- **Escape**: Close modals
- **Ctrl/Cmd + /**: Show all shortcuts

### URL Parameters
Enhance your analytics by adding UTM parameters:
```
https://example.com?utm_source=twitter&utm_medium=social&utm_campaign=spring2024
```

### Integration Ideas
- **Social media**: Create branded short links for posts
- **Email campaigns**: Track click-through rates
- **Print materials**: Use QR codes for easy mobile access
- **Team sharing**: Password-protect internal links

## 📈 Growing Your Usage

### Track Performance
- Monitor which types of content get the most clicks
- Test different shortcode styles
- Analyze traffic sources to understand your audience

### Optimize for Different Platforms
- **Twitter**: Keep total URL + text under character limits
- **Instagram**: Use QR codes since links in posts aren't clickable
- **Email**: Use descriptive shortcodes for trust
- **Print**: Include both short URL and QR code

---

## 🎉 You're All Set!

You now know how to make the most of your Mack.link URL shortener. Create awesome short links, track their performance, and optimize your content sharing strategy!

**Need more help?** Check out the [Setup Guide](./SETUP.md) for deployment instructions or [API Documentation](./API.md) for advanced integrations.

---

*Happy link shortening! 🔗✨*