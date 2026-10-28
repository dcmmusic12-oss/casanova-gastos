# Casa Nova Gastos

Aplicación web (instalable en iPhone y Android) para llevar los gastos e inversión del emprendimiento Casa Nova entre los socios.

- Registro de gastos y aportes a la caja común, con categoría, fecha, quién pagó, método de pago, proveedor y nota.
- Resumen: total invertido, cuánto ha puesto cada socio, balance entre socios, saldo de la caja, gastos por categoría y por mes.
- Sincronización en tiempo real entre celulares (Firebase Firestore) y funcionamiento sin conexión.
- Exportación a CSV para el contador.

## Archivos

- `index.html`, `app.js`: la aplicación.
- `config.js`: datos de conexión a Firebase.
- `firebase.js`: SDK de Firebase empaquetado.
- `sw.js`, `manifest.json`, íconos: instalación como app y modo sin conexión.
- `firestore.rules`: reglas de seguridad de la base de datos (se publican en la consola de Firebase).

## Acceso

Cada libreta vive bajo una clave larga y aleatoria. El link que se comparte entre los socios incluye la clave (`#k=...`); sin ella no se puede leer ni escribir nada.
