# Mack.link 🔗

A fast, secure, and modern URL shortener that you can deploy in minutes. Built with Cloudflare Workers for lightning-fast redirects and featuring a beautiful React management interface with GitHub authentication.

✨ **[Live Demo](https://link.mackhaymond.co)** | 🔧 **[Admin Panel](https://link.mackhaymond.co/admin)**

## ✨ Why Choose Mack.link?

- 🚀 **Blazing Fast**: Powered by Cloudflare's global edge network - redirects in < 50ms worldwide
- 🔒 **Secure by Design**: GitHub OAuth authentication with user restrictions and password-protected links
- 🎨 **Beautiful Interface**: Modern React admin panel with dark/light themes and keyboard shortcuts
- 📊 **Rich Analytics**: Click tracking, UTM parameters, device/browser breakdowns, and export capabilities
- 🌍 **Your Domain**: Use your own custom domain for professional short URLs
- 💰 **Cost Effective**: Runs on Cloudflare's generous free tier (100K requests/day)
- ⚡ **One-Click Deploy**: Deploy your own instance in under 10 minutes

## 🎯 Perfect For

- **Content Creators**: Track link performance across social media platforms
- **Businesses**: Professional branded short links with analytics
- **Developers**: Self-hosted alternative to bit.ly with full control
- **Teams**: Shared link management with GitHub organization authentication

## 🏗️ Architecture

Mack.link runs as a single Cloudflare Worker that handles everything - no complex setup required!

```
                                ┌─────────────────────┐
                                │    Your Visitors    │
                                └──────────┬──────────┘
                                           │
                                           ▼
                               ┌──────────────────────────┐
                               │    Cloudflare Edge       │
                               │   (Global Network)       │
                               └──────────┬───────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────┐
│                        Single Cloudflare Worker                    │
│                                                                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │   Redirect  │    │  Admin UI   │    │      API Server         │ │
│  │/{shortcode} │    │   /admin    │    │       /api/*            │ │
│  │             │    │             │    │                         │ │
│  │ • Password  │    │ • React App │    │ • GitHub OAuth          │ │
│  │   Protected │    │ • Analytics │    │ • Link Management       │ │
│  │ • Scheduled │    │ • Dark/Light│    │ • Analytics Endpoints   │ │
│  │   Links     │    │   Theme     │    │ • Session Management    │ │
│  └─────────────┘    └─────────────┘    └─────────────────────────┘ │
│                                   │                                │
└───────────────────────────────────┼────────────────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │      Cloudflare D1 Database     │
                    │         (Serverless SQLite)     │
                    │                                 │
                    │ • Links & Metadata             │
                    │ • Analytics & Click Tracking   │
                    │ • User Sessions & Security      │
                    └─────────────────────────────────┘
```

**Key Benefits:**
- ⚡ **Single deployment** - no microservices complexity
- 🌍 **Global edge** - fast response times worldwide  
- 🔒 **Built-in security** - OAuth, sessions, password protection
- 📊 **Real-time analytics** - no external tracking needed
- 💰 **Cost effective** - everything runs on Cloudflare's free tier

## 🌐 Live Demo

**Experience Mack.link before deploying your own:**

- 🔗 **Short URLs**: [link.mackhaymond.co](https://link.mackhaymond.co)
- 🎛️ **Admin Panel**: [link.mackhaymond.co/admin](https://link.mackhaymond.co/admin)
- 📁 **Source Code**: [GitHub Repository](https://github.com/mackhaymond/mack.link)

**Example short link**: [link.mackhaymond.co/demo](https://link.mackhaymond.co/demo) → redirects to this repository

## 📊 Performance & Limits

Running on **Cloudflare's Free Tier**:

| Feature | Free Tier Limit | What This Means |
|---------|----------------|-----------------|
| **Redirects** | 100,000/day | ~3,000 clicks per hour sustained |
| **API Requests** | 100,000/day | Unlimited admin usage for most users |
| **Database Storage** | 5GB | Millions of links with analytics |
| **Geographic Reach** | Global | Fast redirects from 300+ edge locations |
| **Custom Domain** | ✅ Included | Professional branded short links |

*Perfect for personal use, small businesses, and content creators.*

## 🔐 Security & Privacy

- 🔑 **GitHub OAuth**: Secure authentication with user access controls
- 🍪 **HttpOnly Cookies**: Session tokens never exposed to client-side JavaScript  
- 🔒 **Password Protection**: Links can be password-protected with PBKDF2 hashing
- 🛡️ **CSRF Protection**: Built-in request validation and rate limiting
- 🔐 **Access Control**: Restrict admin access to specific GitHub users/organizations
- 📝 **Audit Trail**: Track link creation, updates, and access patterns

## 🚀 Development

### Local Development Setup
```bash
# Install dependencies
npm install

# Start development servers
npm run dev
# This starts:
# - Worker dev server at http://localhost:8787
# - React dev server at http://localhost:5173

# Build for production
npm run build

# Deploy to Cloudflare
npm run deploy
```

### Available Commands
- `npm run dev` - Start both worker and admin dev servers (requires GitHub OAuth)
- `npm run dev:ai` - Start in AI/automation-friendly mode (no OAuth required)
- `npm run build` - Build admin panel and embed in worker
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run lint` - Run ESLint on admin code
- `npm run validate:local` - Test local deployment (requires dev server running)
- `npm run validate:prod` - Test production deployment
- `npm run db:apply:local` - Apply database schema locally
- `npm run db:apply:prod` - Apply database schema to production

## 🛠️ Technology Stack

**Backend (Cloudflare Worker):**
- **Runtime**: Cloudflare Workers (V8 JavaScript)
- **Database**: Cloudflare D1 (Serverless SQLite)
- **Authentication**: GitHub OAuth API
- **Sessions**: JWT with HttpOnly cookies

**Frontend (Admin Panel):**
- **Framework**: React 18 with hooks
- **Build Tool**: Vite (fast builds & hot reload)
- **Styling**: Tailwind CSS with dark/light themes
- **Icons**: Lucide React
- **Charts**: Recharts for analytics
- **State**: React Query for server state

**Infrastructure:**
- **CDN**: Cloudflare global edge network
- **Deployment**: Single-command deployment with Wrangler
- **Monitoring**: Built-in Cloudflare Analytics
- **Security**: OAuth, CSRF protection, rate limiting

## 📁 Project Structure

```
mack.link/
├── 📁 worker/              # Cloudflare Worker (Backend)
│   ├── src/
│   │   ├── routes/         # Request handlers
│   │   ├── index.js        # Worker entry point
│   │   ├── auth.js         # GitHub OAuth
│   │   └── db.js           # D1 database operations
│   ├── wrangler.jsonc      # Worker config (includes Static Assets binding for admin SPA)
│   └── package.json
├── 📁 admin/               # React Admin Panel (Frontend)
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── services/       # API client
│   │   └── App.jsx         # Main application
│   ├── package.json
│   └── vite.config.js      # Build configuration
├── 📁 docs/                # Documentation
│   ├── SETUP.md           # Deployment guide
│   ├── API.md             # API reference
│   └── ...
├── package.json           # Root workspace config
└── README.md              # This file
```

## 🚀 Quick Start

### Option 1: Try it Out (2 minutes)
Use the [live demo](https://link.mackhaymond.co/admin) to test the interface before deploying your own.

### Option 2: Deploy Your Own (10 minutes)
```bash
# 1. Fork this repository on GitHub
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/mack.link.git
cd mack.link

# 3. Install dependencies
npm install

# 4. Deploy to Cloudflare Workers
npm run deploy
```

📖 **Need help?** Follow our detailed [Setup Guide](./docs/SETUP.md) for step-by-step instructions.

### What You Get
- 🔗 **Short URLs**: `https://yourdomain.com/abc123`
- 🎛️ **Admin Panel**: `https://yourdomain.com/admin`
- 📊 **Analytics**: Click tracking, referrers, device stats
- 🔐 **Password Protection**: Secure links with password protection
- ⏰ **Scheduled Links**: Set activation and expiration dates

## 📖 Documentation

**For Users:**
- 🚀 [**Setup Guide**](./docs/SETUP.md) - Deploy your own instance in 10 minutes
- 📖 [**User Guide**](./docs/USER_GUIDE.md) - How to use the admin interface effectively

**For Developers:**
- 🔧 [**Development Guide**](./docs/DEVELOPMENT.md) - Local development setup
- 📡 [**API Reference**](./docs/API.md) - Complete API documentation  
- 🚀 [**Deployment Guide**](./docs/DEPLOYMENT.md) - Production deployment details
- 🔑 [**GitHub Secrets**](./docs/GITHUB_SECRETS.md) - CI/CD configuration
- 🏗️ [**Architecture Decisions**](./docs/ADMIN_INTEGRATION.md) - Technical design choices
- 💡 [**Feature Ideas**](./docs/FEATURE_IDEAS.md) - Future enhancements and roadmap

**For Contributors:**
- 🤝 [**Contributing Guide**](./docs/CONTRIBUTING.md) - How to contribute to the project

**Troubleshooting:**
- Common issues and solutions in each guide
- Check the [GitHub Issues](https://github.com/mackhaymond/mack.link/issues) for community support

## 🤝 Contributing

We welcome contributions! Here's how you can help:

- 🐛 **Report Bugs**: [Open an issue](https://github.com/mackhaymond/mack.link/issues/new) with detailed reproduction steps
- 💡 **Request Features**: Describe your use case and proposed solution
- 📖 **Improve Docs**: Fix typos, add examples, or clarify instructions
- 🔧 **Submit Code**: Fork, create a feature branch, and submit a pull request

**Development Setup:**
1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/mack.link.git`
3. Install dependencies: `npm install`
4. Apply database schema: `npm run db:apply:local`
5. Start development: `npm run dev:ai` (for AI agents) or `npm run dev` (requires GitHub OAuth)
6. Submit a pull request with a clear description

## ❤️ Support

If Mack.link helps you or your organization, consider:

- ⭐ **Star this repository** to show your support
- 🐦 **Share it** with others who might find it useful
- 🍕 **[Buy me a coffee](https://github.com/sponsors/mackhaymond)** to fuel development

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

**Free to use for personal and commercial projects.**

---

<div align="center">

**🔗 Built with ❤️ by [mackhaymond](https://github.com/mackhaymond)**

*Powered by Cloudflare Workers & React*

[⭐ Star on GitHub](https://github.com/mackhaymond/mack.link) • [🚀 Try the Demo](https://link.mackhaymond.co/admin) • [📖 Read the Docs](./docs/SETUP.md)

</div>
