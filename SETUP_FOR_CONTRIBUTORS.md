# 🚀 Setup Guide for Contributors

## Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/elder_care_fyp.git
cd elder_care_fyp
```

## Backend Setup

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

## Frontend Setup

```bash
cd ../frontend
npm install
```

## Run Both Services

### Backend (Terminal 1)
```bash
cd backend
venv\Scripts\activate  # or source venv/bin/activate on Mac/Linux
python main.py
```

### Frontend (Terminal 2)
```bash
cd frontend
npm run dev
```

Visit `http://localhost:5173` in your browser.

## Contributing

### 1. Update Your Local Code
```bash
git pull origin main
```

### 2. Create a Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 3. Make Your Changes
Edit files, test locally

### 4. Commit & Push
```bash
git add .
git commit -m "Describe what you changed"
git push origin feature/your-feature-name
```

### 5. Create a Pull Request
- Go to GitHub
- Click "Pull Request"
- Describe your changes
- Wait for review

## 🎯 Naming Conventions

- **Features**: `feature/fall-detection-v2`
- **Bugfixes**: `bugfix/camera-crash`
- **Documentation**: `docs/installation-guide`

## ⚠️ Important Rules

❌ **Never commit to `main` directly**  
✅ **Always use feature branches**  
✅ **Pull before pushing**  
✅ **Write clear commit messages**

## Troubleshooting

**"No module named 'cv_modules'"**
- Make sure you `cd backend` before running `python main.py`

**"npm: command not found"**
- Install Node.js from nodejs.org

**"Git not found"**
- Install Git from git-scm.com

**Merge conflict?**
- Contact the main developer
- We'll help resolve it

---

Happy contributing! 🎉
