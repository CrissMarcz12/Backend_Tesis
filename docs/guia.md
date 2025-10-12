# Guía de consumo del backend desde React

Esta guía resume todos los endpoints disponibles y explica cómo consumirlos paso a paso desde un frontend en React. La API trabaja con **sesiones de servidor** (cookies) y responde siempre en **JSON**.

## 1. Configuración previa

1. Define las variables de entorno clave al arrancar el backend:
   - `SESSION_SECRET`: cadena aleatoria para firmar la cookie.
   - `FRONTEND_URL`: URL base pública del frontend (por ejemplo, `http://localhost:5173`).
   - `CORS_EXTRA_ORIGINS` (opcional): lista separada por comas con orígenes adicionales permitidos.
2. Arranca el backend (`npm run dev` o `node src/server.js`).
3. En React, todas las peticiones deben incluir `credentials: "include"` para que el navegador envíe la cookie de sesión.

```ts
// Ejemplo de helper en React (TypeScript) para llamar a la API
export async function apiFetch<T>(input: RequestInfo, init: RequestInit = {}) {
  const response = await fetch(`${import.meta.env.VITE_API_URL}${input}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });

  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || "Error"), { data });
  return data as T;
}
```

## 2. Autenticación y sesión (`/auth`)

| Método | Endpoint | Uso |
| ------ | -------- | --- |
| `POST` | `/auth/register` | Registrar un usuario clásico. |
| `POST` | `/auth/login` | Iniciar sesión con email y contraseña. |
| `POST` | `/auth/verify` | Confirmar código de verificación enviado por correo. |
| `POST` | `/auth/logout` | Cerrar sesión actual. |
| `GET` | `/auth/google` | Redirige a Google OAuth (abrir en nueva pestaña/ventana). |
| `GET` | `/auth/google/callback` | URL de retorno de Google (configurada en Google Cloud). |
| `GET` | `/auth/set-password` | Verifica si el usuario autenticado puede definir contraseña. |
| `POST` | `/auth/set-password` | Define o actualiza la contraseña del usuario logueado. |

### Flujo recomendado

1. **Registro** (`POST /auth/register`)
   ```ts
   await apiFetch("/auth/register", {
     method: "POST",
     body: JSON.stringify({
       email,
       display_name,
       password,
     }),
   });
   ```
   - Respuesta exitosa (`ok: true`) abre sesión directamente.
   - Si se registró tras Google, devuelve `requiresGoogleLink: true`.

2. **Login** (`POST /auth/login`)
   ```ts
   const { requiresVerification, email } = await apiFetch<{ ok: true; requiresVerification: boolean; email?: string }>(
     "/auth/login",
     {
       method: "POST",
       body: JSON.stringify({ email, password }),
     }
   );
   if (requiresVerification) {
     // Muestra modal para capturar código de verificación y llama a /auth/verify
   }
   ```
   - Usuarios administradores entran directo (`requiresVerification: false`).
   - Usuarios estándar reciben un código de verificación por correo.

3. **Verificación** (`POST /auth/verify`)
   ```ts
   await apiFetch("/auth/verify", {
     method: "POST",
     body: JSON.stringify({ email, code }),
   });
   ```
   - Si durante el login se guardó `pendingUserId` en la sesión, no es necesario enviar `email`.

4. **Cerrar sesión** (`POST /auth/logout`)
   ```ts
   await apiFetch("/auth/logout", { method: "POST" });
   ```

5. **Google OAuth**
   - Inicia flujo con `window.location.href = "${API_URL}/auth/google"` o abre en ventana emergente.
   - Configura `FRONTEND_URL` para que el backend redirija de vuelta (`/login`, `/register`, `/profile`, etc.).
   - Si el usuario no existe, el backend guarda el email y redirige a `/register?google=1` en el front.

6. **Definir contraseña** (`POST /auth/set-password`)
   - Útil para usuarios creados vía Google que luego desean contraseña local.

## 3. Estado de autenticación

- `GET /me`: devuelve `{ isAuthenticated: boolean, user?: { ... } }`.
- Útil para hidratar el estado global de React al montar la app.

```ts
const { isAuthenticated, user } = await apiFetch("/me", { method: "GET" });
```

## 4. Datos de la cuenta (`/api/account`)

| Método | Endpoint | Uso |
| ------ | -------- | --- |
| `GET` | `/api/account` | Obtiene perfil básico del usuario logueado. |
| `PUT` | `/api/account` | Actualiza nombre y/o contraseña. |

```ts
await apiFetch("/api/account", {
  method: "PUT",
  body: JSON.stringify({
    display_name: "Nuevo nombre",
    current_password: "actual",
    new_password: "nuevoPass123",
    confirm_password: "nuevoPass123",
  }),
});
```

## 5. Chat para usuarios (`/api/chat`)

Todas estas rutas requieren sesión iniciada.

| Método | Endpoint | Uso |
| ------ | -------- | --- |
| `GET` | `/api/chat/conversations` | Lista conversaciones donde participa el usuario. |
| `POST` | `/api/chat/conversations` | Crea conversación (el usuario queda como owner). |
| `GET` | `/api/chat/conversations/:id` | Detalle de una conversación (si es participante). |
| `GET` | `/api/chat/conversations/:id/messages` | Mensajes ordenados cronológicamente. |
| `POST` | `/api/chat/conversations/:id/messages` | Agrega mensaje. |
| `POST` | `/api/chat/messages/:id/feedback` | Califica un mensaje. |

Ejemplos:

```ts
// Crear conversación
const { data: conversation } = await apiFetch("/api/chat/conversations", {
  method: "POST",
  body: JSON.stringify({ title: "Demo" }),
});

// Enviar mensaje
await apiFetch(`/api/chat/conversations/${conversation.id}/messages`, {
  method: "POST",
  body: JSON.stringify({ content: "Hola", sender: "user" }),
});

// Traer mensajes
const { data: messages } = await apiFetch(`/api/chat/conversations/${conversation.id}/messages`);
```

## 6. Panel administrativo

Todas las rutas requieren sesión y rol `admin`.

### Usuarios (`/api/admin/users`)

| Método | Endpoint | Uso |
| ------ | -------- | --- |
| `GET` | `/api/admin/users` | Lista paginada de usuarios con filtros (`q`, `status`, `role`). |
| `POST` | `/api/admin/users/:id/grant-admin` | Asigna rol administrador. |
| `POST` | `/api/admin/users/:id/revoke-admin` | Quita rol admin y asegura rol `user`. |

### Conversaciones (`/api/admin/chat`)

| Método | Endpoint | Uso |
| ------ | -------- | --- |
| `GET` | `/api/admin/chat/conversations` | Listado paginado con estadísticas globales. |
| `GET` | `/api/admin/chat/conversations/:id` | Detalle completo (participantes, mensajes, feedback). |
| `GET` | `/api/admin/chat/feedback/summary` | Promedios y conteos de calificaciones por usuario. |
| `GET` | `/api/admin/chat/feedback/messages` | Calificaciones individuales con filtros. |

```ts
// Ejemplo: obtener usuarios para un panel admin
const { data, total } = await apiFetch(`/api/admin/users?page=1&limit=20&q=${search}`);

// Promocionar a admin
await apiFetch(`/api/admin/users/${userId}/grant-admin`, { method: "POST" });
```

## 7. Manejo de errores

- Las respuestas de error siempre incluyen `{ ok: false, message | error }`.
- Para CORS inválido se recibe `403` con `message: "CORS no permitido"`.
- Maneja errores en React capturando la excepción del helper `apiFetch` y mostrando `error.data.message` al usuario.

## 8. Resumen del flujo inicial en React

1. Al cargar la app, llama a `GET /me` para conocer el estado de la sesión.
2. Si el usuario no está autenticado, muestra formularios de login/registro.
3. Tras login:
   - Si `requiresVerification` es `true`, muestra input del código y llama a `/auth/verify`.
   - Si es `false`, redirige al dashboard.
4. Mantén la cookie de sesión enviando `credentials: "include"` en todas las peticiones.
5. Para cerrar sesión, `POST /auth/logout` y limpia el estado local.

Con esta guía puedes conectar tu frontend en React a todo el backend sin depender de vistas HTML. Ajusta los componentes y hooks de React usando los ejemplos de `fetch` anteriores.