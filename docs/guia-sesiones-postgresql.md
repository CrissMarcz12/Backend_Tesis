# Guía de Configuración - Sistema de Sesiones con PostgreSQL

## ✅ Cambios Implementados

### 1. PostgreSQL Session Store

Se reemplazó **MemoryStore** (no apto para producción) por **PostgreSQL Session Store** usando `connect-pg-simple`.

**Antes:**

```javascript
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // ❌ Usaba MemoryStore por defecto
  })
)
```

**Ahora:**

```javascript
const PgSession = connectPgSimple(session)

app.use(
  session({
    store: new PgSession({
      pool: pool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'connect.sid',
    cookie: {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 24 horas
      path: '/',
    },
  })
)
```

### 2. Mejoras en CORS

Se agregó `exposedHeaders: ["Set-Cookie"]` para permitir que el frontend acceda a las cookies en solicitudes cross-domain.

### 3. Dependencia Instalada

```bash
npm install connect-pg-simple
```

---

## 🔧 Configuración de Variables de Entorno

### Desarrollo Local

```env
NODE_ENV=development
CORS_ALLOW_ALL=true
SESSION_SECRET=tu_secreto_unico_aqui
DATABASE_URL=postgresql://usuario:password@localhost:5432/tesis_db
FRONTEND_URL=http://localhost:5173
```

### Producción (Render)

```env
NODE_ENV=production
CORS_ALLOW_ALL=false
FRONTEND_URL=https://main.d2htzx0rfkpybz.amplifyapp.com
CORS_EXTRA_ORIGINS=https://main.d2htzx0rfkpybz.amplifyapp.com
SESSION_SECRET=genera_uno_nuevo_con_openssl_rand_base64_32
DATABASE_URL=postgresql://usuario:password@host/database
```

**⚠️ IMPORTANTE:** `SESSION_SECRET` debe ser diferente de `GOOGLE_CLIENT_SECRET`

---

## 🗄️ Tabla de Sesiones en PostgreSQL

La tabla `user_sessions` se crea automáticamente con esta estructura:

```sql
CREATE TABLE "user_sessions" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "user_sessions" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "IDX_session_expire" ON "user_sessions" ("expire");
```

### Limpieza Automática

Las sesiones expiradas se eliminan cada 15 minutos gracias a:

```javascript
pruneSessionInterval: 60 * 15
```

---

## 🔐 Cómo Funcionan las Sesiones Cross-Domain

### 1. Login del Usuario

```
Cliente (localhost:5173) → POST /auth/login → Backend (localhost:3000)
                                              ↓
                                        Sesión guardada en PostgreSQL
                                              ↓
                                        Cookie 'connect.sid' enviada al cliente
```

### 2. Verificación de Sesión

```
Cliente → GET /me (con cookie) → Backend
                                   ↓
                              Lee sesión desde PostgreSQL
                                   ↓
                              Retorna usuario autenticado
```

### 3. Configuración de Cookies

- **httpOnly**: `true` - La cookie no es accesible desde JavaScript
- **sameSite**: `"none"` en producción - Permite cookies cross-domain
- **secure**: `true` en producción - Solo HTTPS
- **maxAge**: 24 horas - La sesión expira después de 1 día

---

## 🚀 Despliegue en Render

### Pasos:

1. **Actualizar Variables de Entorno:**

   - Ve a tu servicio en Render
   - En "Environment", agrega/actualiza:
     ```
     CORS_ALLOW_ALL=false
     FRONTEND_URL=https://main.d2htzx0rfkpybz.amplifyapp.com
     SESSION_SECRET=nuevo_secreto_generado
     NODE_ENV=production
     ```

2. **Generar SESSION_SECRET:**

   ```bash
   openssl rand -base64 32
   ```

3. **Redeploy:**

   - Render detectará los cambios en `package.json` y `server.js`
   - Instalará automáticamente `connect-pg-simple`

4. **Verificar Logs:**
   - Busca: `🚀 Backend en Render corriendo en puerto...`
   - **No debería aparecer** el warning de MemoryStore

---

## 🧪 Pruebas

### Local

1. Inicia el backend:

   ```bash
   npm run dev
   ```

2. Verifica que no aparezca:

   ```
   Warning: connect.session() MemoryStore is not designed for a production environment
   ```

3. Prueba el login:

   ```bash
   curl -X POST http://localhost:3000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@test.com","password":"test123"}' \
     -c cookies.txt
   ```

4. Verifica la sesión:
   ```bash
   curl http://localhost:3000/me -b cookies.txt
   ```

### Producción

1. Desde el frontend en Amplify, prueba login
2. Verifica en DevTools → Application → Cookies
3. Debería aparecer `connect.sid` con:
   - `SameSite: None`
   - `Secure: true`
   - `HttpOnly: true`

---

## 📊 Beneficios

| Antes (MemoryStore)                     | Ahora (PostgreSQL)             |
| --------------------------------------- | ------------------------------ |
| ❌ No escala                            | ✅ Escala horizontalmente      |
| ❌ Se pierde al reiniciar               | ✅ Persiste en base de datos   |
| ❌ No funciona con múltiples instancias | ✅ Funciona con load balancers |
| ❌ Fuga de memoria                      | ✅ Limpieza automática         |

---

## 🐛 Solución de Problemas

### "No session cookie found" en el frontend

**Causa:** Las cookies no se están enviando cross-domain

**Solución:**

1. Verifica que en el frontend uses `credentials: 'include'`
2. Verifica CORS en backend: `credentials: true`
3. Verifica `sameSite: "none"` en producción

### Sesiones se pierden al reiniciar

**Antes (MemoryStore):** Normal, se guardaban en RAM

**Ahora (PostgreSQL):** Las sesiones persisten. Si se pierden:

1. Verifica que `DATABASE_URL` sea correcta
2. Revisa logs de PostgreSQL
3. Verifica que la tabla `user_sessions` exista

### Error "relation user_sessions does not exist"

**Solución:** La tabla se crea automáticamente, pero si no:

```sql
CREATE TABLE "user_sessions" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  PRIMARY KEY ("sid")
);
```

---

## 📝 Notas Finales

- ✅ El backend ahora es **production-ready**
- ✅ Las sesiones persisten en PostgreSQL
- ✅ Compatible con múltiples instancias/load balancers
- ✅ Limpieza automática de sesiones expiradas
- ✅ Compatible con cookies cross-domain (Amplify ↔ Render)
