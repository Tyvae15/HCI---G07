# Mapa de Relatos: Proyecto C (HCI · ULima 2026-2)

**Plataforma de narración colaborativa y espacial.** Las historias se escriben sobre un mapa real: cada escena es un **nodo** anclado a un lugar, las escenas se unen en **rutas** y quien lee **recorre** la historia caminando. Desbloquea cada lugar con un **QR**, con su **GPS** o con un **código corto**.

Funciona sin instalar nada aparte de Node.js: **no tiene dependencias npm**. Leaflet, el generador de QR y el lector de QR se cargan desde CDN.

---

## 1. Cómo ejecutarlo

```bash
# Requisito: Node.js 18 o superior
cd narrativa-espacial
node server.mjs          # o: npm start
# Abrir http://localhost:3000
```

- **Modo compartido (con servidor):** todos los que abran la URL ven y editan la misma historia. Los datos se guardan en `data/db.json`. Otros dispositivos de la misma Wi-Fi entran con `http://IP-DE-TU-PC:3000`.
- **Modo local (sin servidor):** si se sirve solo la carpeta `public/` (por ejemplo en GitHub Pages o con `python -m http.server`), todo se guarda en el navegador. Se pueden abrir **dos pestañas** para simular dos autores (los cambios se sincronizan entre ellas).
- **Pruebas del modelo:** `npm test`

### Cámara y GPS en el celular
Los navegadores solo permiten cámara y ubicación en **HTTPS** o en `localhost`. Por `http://IP:3000` el escáner del celular se queda en negro. Para probar en el celular hay cuatro opciones:
0. **HTTPS local (Windows, lo más rápido):** ejecuten una vez `powershell -ExecutionPolicy Bypass -File scripts\crear-certificado.ps1` y reinicien con `npm start`. El servidor abre también `https://IP-DE-TU-PC:3443` y los QR apuntan ahí. Como el certificado es autofirmado, la primera vez el celular muestra una advertencia: toquen **Avanzado → Continuar**. Si cambian de red Wi-Fi, vuelvan a crear el certificado.
1. **GitHub Pages** (gratis y con HTTPS): suban la carpeta `public/` a un repositorio y activen Pages. Funciona en modo local, sin colaboración entre dispositivos. **Este es el enlace público del prototipo** que pide el Entregable 2.
2. **Túnel HTTPS** al servidor, por ejemplo `npx localtunnel --port 3000` o `cloudflared tunnel --url http://localhost:3000`. Así tienen modo compartido con HTTPS.
3. Sin HTTPS igual funcionan la **foto del QR** (subir o tomar una imagen), el **código manual** y abrir el QR con la **cámara nativa** del celular.

---

## 2. Estructura del código

```
narrativa-espacial/
├── server.mjs            Servidor Node sin dependencias: archivos estáticos + API + db.json
├── package.json
├── tests/model.test.mjs  Pruebas automáticas de las reglas de colaboración
└── public/
    ├── index.html        Estructura de la interfaz (barra, mapa, panel, diálogos)
    ├── css/styles.css    Guía de estilos: colores con contraste WCAG, estados, responsive
    └── js/
        ├── model.js      Modelo de datos + operaciones + versiones/conflictos (compartido con el servidor)
        ├── seed.js       Historia de ejemplo "Ecos de Barranco"
        ├── store.js      Sincronización, modo sin conexión (bandeja de salida), modo local
        ├── map.js        Mapa Leaflet: pines, rutas, posición GPS
        ├── qr.js         Generar, imprimir y escanear QR + código manual con sugerencias
        ├── media.js      Fotos comprimidas y grabación de audio
        ├── ui.js         Utilidades: avisos, diálogos accesibles, avatares, fechas
        ├── testmode.js   Herramienta del facilitador: tiempos, errores, SEQ, SUS → CSV
        └── app.js        Controlador: une todo y define los flujos de interacción
```

**Arquitectura:** toda modificación es una *operación* (`node.create`, `fragment.edit`, `route.create`, `read.mark`…). La aplica `applyOp()` en `model.js`, tanto en el navegador como en el servidor, así que las reglas son idénticas en ambos lados.

```
Interfaz (app.js) ──dispatch(op)──▶ store.js ──POST /api/ops──▶ server.mjs ──applyOp──▶ db.json
        ▲                              │  ◀── GET /api/state cada 4 s (cambios de otros) ──┘
        └──────── evento 'change' ─────┘
```

---

## 3. Retos de HCI del enunciado y dónde se resuelven

| Reto (catálogo de proyectos) | Solución en el prototipo | Archivo |
|---|---|---|
| **Interacción espacial legible**: el mapa en primer plano, con affordances claras para "dibujar ruta", "anclar nodo" y "agregar contenido" | El mapa ocupa casi toda la pantalla. Las herramientas llevan icono y texto (no solo icono). Una pista contextual indica el siguiente paso ("Toca los pines en el orden…"). La ruta en borrador se ve punteada. | `map.js`, `app.js` → `renderBars()` |
| **Anclaje físico robusto** (QR dañado, mal escaneado, sin señal) | Cuatro caminos: QR con la cámara nativa (enlace `?n=CÓDIGO`), escáner dentro de la app, foto del QR, o un código de 4 caracteres sin letras ambiguas (0/O/1/I). Si hay un error de una letra, la app sugiere el código correcto (distancia de Levenshtein). El QR usa corrección de errores nivel H (~30 %). | `qr.js`, `model.js` → `suggestNodesByCode()` |
| **Colaboración asíncrona coherente** (varios autores, conflictos versionados, atribución, "ruta leída") | Cada fragmento tiene versión e historial. Si dos personas editan a la vez, se muestran **ambas versiones lado a lado** (conservar la otra, usar la mía o combinar). Cada fragmento muestra autor, color y "editado por". Se registra quién leyó cada nodo y cuánto avanzó cada persona en cada ruta. Hay una sección de actividad reciente y avisos de lo que hacen otros autores. | `model.js` → `applyOp()`, `app.js` → `resolveConflict()` |
| **Transición entre roles** (creador ↔ lector) sin romper el modelo mental espacial | Un solo interruptor **Crear / Recorrer** sobre el mismo mapa. Al cambiar de rol se mantienen la vista, el nodo abierto y el recorrido en curso. En Recorrer se puede **"Continuar la historia aquí"** sin salir del recorrido. | `app.js` → `setRole()`, `nodeView()` |
| Nuevos autores sin un punto de partida claro (problema del enunciado) | La sección **"Dónde puedes contribuir"** muestra nodos que invitan a continuar, nodos con pocos fragmentos y finales de ruta. Al terminar una ruta aparece la invitación "¿Qué pasa después?". | `model.js` → `contributionPoints()` |

### Heurísticas de Nielsen aplicadas (útil para la sustentación)

1. **Visibilidad del estado:** indicador de sincronización (en línea, local, sin conexión con N cambios pendientes), barra de progreso de la ruta, contador de caracteres y avisos tras cada acción.
2. **Relación con el mundo real:** los pines representan lugares reales, el vocabulario es "lugar", "ruta" y "recorrer", y la distancia se muestra en metros.
3. **Control y libertad:** **Deshacer** al eliminar un nodo, fragmento o ruta, o al mover un pin. Esc cancela cualquier herramienta. El último punto de una ruta se puede quitar.
4. **Consistencia:** los mismos colores y símbolos para los estados en el mapa, en la lista y en la leyenda.
5. **Prevención de errores:** códigos sin caracteres ambiguos. No se puede guardar una ruta de menos de 2 nodos (el botón se desactiva). Un tap en el mapa durante el modo ruta muestra un aviso en lugar de fallar en silencio.
6. **Reconocer antes que recordar:** sugerencias "¿Quisiste decir…?", lista de puntos de partida y pistas contextuales.
7. **Flexibilidad:** atajos N y R, anclar con GPS ("Anclar aquí") y cuatro formas de desbloquear.
8. **Diseño minimalista:** una tarea principal por pantalla en móvil (hoja inferior plegable).
9. **Recuperarse de errores:** mensajes en lenguaje humano con la solución (`ERROR_MESSAGES` en `model.js`).
10. **Ayuda:** bienvenida de 3 pasos, diálogo de ayuda con leyenda y atajos.

### Accesibilidad (WCAG 2.2)
Contraste de 4.5:1 o más en todos los tokens (ver encabezado de `styles.css`). Los estados nunca dependen solo del color (pin gris "?" frente a verde "✓"). Hay foco visible, enlace "saltar al panel", pines accesibles por teclado con texto alternativo, `aria-live` en los avisos y una **vista lista** como alternativa al mapa. Las fotos llevan descripción. Los objetivos táctiles miden 44 px o más (ley de Fitts) y se respeta `prefers-reduced-motion`.

---

## 4. Modo "Prueba de usabilidad" (Entregable 2, Sección 6)

Menú ☰ → **🧪 Prueba de usabilidad**. Es una herramienta para el facilitador:

1. **Tarea:** se ingresa el ID del participante (P01…), se elige el escenario (T1–T6), se lee en voz alta y se pulsa *Iniciar*. Una barra pequeña muestra el tiempo. **+ Error** registra errores observados, y la app cuenta además los **errores automáticos** (validaciones fallidas, código no encontrado, clic en el mapa en modo ruta…).
2. **Terminar:** se registra el resultado (éxito, parcial o fracaso), el **SEQ** (1–7) y las notas del **Think-Aloud**.
3. **SUS:** cuestionario de 10 ítems con el puntaje calculado (0–100) y su interpretación según Bangor et al. (2009).
4. **Resultados:** % de éxito, tiempo (media ± DE), errores, SEQ medio y SUS medio. Se exporta a **CSV** para Excel, SPSS o R.

Los escenarios están en `TASKS` dentro de `testmode.js`. Ajústenlos a sus preguntas de investigación. Para T6 (conflicto), el facilitador edita el mismo fragmento en otra pestaña o dispositivo justo antes de que el participante guarde.

---

## 5. Limitaciones conocidas (para "Trabajo futuro")
- No hay autenticación real: el autor es un perfil elegido en el dispositivo (suficiente para un prototipo de prueba).
- En modo local, el almacenamiento del navegador ronda los 5 MB, así que caben pocas fotos o audios. El servidor no tiene ese límite.
- La resolución de conflictos es a nivel de fragmento completo, no de palabras (un siguiente paso sería un CRDT, como Yjs).
- Los mapas de OpenStreetMap necesitan internet. Sin él, la app ofrece la vista lista y el código manual.
- El desbloqueo por GPS usa un radio fijo de 40 m. En exteriores la precisión del GPS varía entre 5 y 30 m.
