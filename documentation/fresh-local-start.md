# Fresh Local Start Guide

This guide helps you start from a clean slate for local development. Use these steps if you encounter dependency issues or want to ensure a fresh environment.

## 1. Remove All `node_modules` and Lock Files

From your project root:

```
rm -rf node_modules
rm -rf backend/node_modules
rm -rf frontend/node_modules
rm -f package-lock.json
rm -f backend/package-lock.json
rm -f frontend/package-lock.json
```

## 2. Check for `package.json` Files

```
ls package.json
ls backend/package.json
ls frontend/package.json
```

## 3. Install Dependencies

```
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

## 4. (Optional) Ensure `axios` is Installed in Backend and Frontend

```
cd backend && npm install axios && cd ..
cd frontend && npm install axios && cd ..
```

## 5. Generate Prisma Client and Push Schema

```
cd backend
npx prisma generate
npx prisma db push
cd ..
```

## 6. Start Your Apps

- Backend: `cd backend && npm run dev` or `npm start`
- Frontend: `cd frontend && npm run dev`

---

*Use these steps whenever you want to reset your local environment or resolve persistent dependency issues.* 