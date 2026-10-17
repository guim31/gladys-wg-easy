# WireGuard (wg-easy)

Sepa desde Gladys quién está conectado al VPN WireGuard de su casa cuando ese
VPN está gestionado por [wg-easy](https://github.com/wg-easy/wg-easy): un
dispositivo por cliente VPN (conectado o no, datos recibidos y enviados, último
handshake), un widget para el panel y disparadores de escena cuando un cliente
se conecta o se desconecta — por ejemplo, para saber que alguien ha abierto el
VPN de la casa mientras usted está fuera.

Probada con servidores wg-easy 15.4 y 14 reales en Docker y con un cliente
WireGuard real. Sus comentarios son bienvenidos en el
[foro de Gladys](https://community.gladysassistant.com) o en las
[issues](https://github.com/guim31/gladys-wg-easy/issues).

## Qué necesita

- Gladys Assistant 5.1.0 o posterior.
- **wg-easy v15** (15.0 a 15.4) o **v14**, accesible desde Gladys en su red
  local (puerto 51821 de su interfaz web por defecto).
- En v15: el usuario y la contraseña de un usuario de wg-easy **sin
  autenticación de dos factores** (wg-easy niega a ese usuario el acceso a la
  API por contraseña). Un administrador ve todos los clientes, otro usuario
  solo los suyos. El acceso por contraseña no debe estar desactivado
  (`DISABLE_PASSWORD_AUTH`).
- En v14: la contraseña de la interfaz web, o nada si no tiene.

## Configuración

1. En Gladys, instale la integración y abra su pantalla **Configuración**.
2. **Dirección**: la dirección de la interfaz web de wg-easy, por ejemplo
   `192.168.1.2:51821`, con `https://` si se sirve por HTTPS (detrás de un
   proxy inverso, por ejemplo). La ruta se ignora.
3. **Usuario (v15)**: `admin` por defecto; se ignora en v14.
4. **Contraseña**: la de este usuario (v15) o la de la interfaz web (v14).
5. **Aceptar certificados autofirmados**: solo para una dirección `https://`
   cuyo certificado no esté firmado por una autoridad conocida.
6. **Intervalo de actualización**: frecuencia de lectura de wg-easy, 30 s por
   defecto. Cada lectura comprueba la contraseña en wg-easy (argon2 en v15,
   una fracción de segundo de procesador).
7. **Permitir habilitar y deshabilitar clientes**: desactivado por defecto.
   Vea más abajo.
8. **Idioma de los nombres**: el idioma de los nombres de las funciones y de la
   fecha del último handshake, fijado al añadir un dispositivo.
9. Guarde y use **Probar la conexión**: responde con la versión de wg-easy, el
   número de clientes y cuántos están conectados.
10. En la pestaña **Descubrimiento**, añada el servidor y los clientes que
    quiera seguir.

La versión (v15 o v14) se detecta sola. Los disparadores de escena y el widget
funcionan incluso para los clientes no añadidos a Gladys.

## Los dispositivos

**El servidor** (`wg-easy` seguido de su dirección):

| Función             | Qué muestra                         |
| ------------------- | ----------------------------------- |
| Clientes conectados | Clientes conectados en este momento |
| Clientes            | Clientes configurados en wg-easy    |

**Cada cliente VPN** (su nombre en wg-easy seguido de `(VPN)`):

| Función                 | Qué muestra                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Conectado               | Sí cuando el último handshake tiene menos de 3 minutos y el cliente está habilitado    |
| Acceso habilitado       | Si el cliente está habilitado en wg-easy (un interruptor, de solo lectura por defecto) |
| Recibido por el cliente | Datos descargados por el cliente a través del VPN, en MB                               |
| Enviado por el cliente  | Datos enviados por el cliente a través del VPN, en MB                                  |
| Último handshake        | Fecha y hora del último handshake de WireGuard, o «Nunca»                              |

**Conectado** sigue al propio WireGuard: mientras pasan paquetes, el cliente
renueva su handshake cada 2 minutos. Un cliente que deja de enviar (un teléfono
en reposo, sin _Persistent keepalive_) cuenta como desconectado 3 minutos
después de su último handshake, aunque su túnel siga «activado» en el teléfono.

Los contadores de datos son los de la interfaz WireGuard: vuelven a cero al
reiniciar wg-easy o su interfaz, y se desconocen para un cliente deshabilitado.

**Acceso habilitado** es de solo lectura mientras no marque **Permitir
habilitar y deshabilitar clientes**. Una vez marcada, Gladys, sus escenas y los
asistentes de voz pueden cortar el acceso de un cliente (por ejemplo el perfil
VPN de un niño, por la noche). Déjela desmarcada si no la necesita: es su
acceso VPN desde el exterior. Tras cambiar esta opción, use **Actualizar** en
la pestaña Descubrimiento para que el interruptor cambie en Gladys.

Un cliente se identifica por su clave pública WireGuard: cambiarle el nombre en
wg-easy, o pasar de la v14 a la v15, conserva el dispositivo y su historial.

## Panel

El widget **Clientes VPN** muestra el número de clientes conectados y de
clientes, y luego una línea por cliente: primero los conectados (_Conectado_),
luego los demás con el tiempo transcurrido desde su último handshake (_hace
2 h_ o _Nunca conectado_), los deshabilitados al final (_Deshabilitado_). Diez
líneas como máximo; más allá, la última línea cuenta los demás clientes.

## Escenas

### Disparadores

- **Cliente VPN conectado**: un cliente se ha conectado al VPN de la casa (un
  handshake tras 3 minutos de silencio). Filtro: un cliente, o cualquiera.
  Variables: nombre del cliente, dispositivo del cliente.
- **Cliente VPN desconectado**: un cliente lleva 3 minutos sin handshake o ha
  sido deshabilitado. Filtro: un cliente, o cualquiera. Variables: nombre del
  cliente, dispositivo del cliente, minutos conectado.
- **wg-easy ya no responde**: wg-easy ha dejado de responder (dos lecturas
  seguidas). Variable: el error.
- **wg-easy responde de nuevo**: wg-easy responde de nuevo tras una avería.
  Variable: minutos sin respuesta.

No se envía ningún evento al iniciar la integración: el estado anterior no se
conoce.

### Ideas de escenas

- **Alguien ha abierto el VPN de la casa**: _Cliente VPN conectado_ (cualquier
  cliente) → enviar un mensaje «{{client}} está conectado al VPN de la casa».
- **El teléfono del niño sigue en el VPN por la noche**: _Cliente VPN
  conectado_, el teléfono del niño, entre las 22:00 y las 7:00 → apagar su
  _Acceso habilitado_ (control permitido).
- **La caja del VPN está caída**: _wg-easy ya no responde_ → enviar un mensaje
  con el error, antes de necesitar el VPN desde el exterior.

## Solución de problemas

- **«usuario o contraseña rechazados (o autenticación de dos factores
  activa)»**: compruebe el usuario (v15) y la contraseña. wg-easy v15 niega el
  acceso a la API por contraseña a un usuario con autenticación de dos
  factores: cree para Gladys un usuario sin ella.
- **«acceso denegado: inicio de sesión con contraseña o usuario
  desactivado»**: el usuario está desactivado, o wg-easy funciona con
  `DISABLE_PASSWORD_AUTH`.
- **«la dirección redirige»**: la dirección responde con una redirección,
  normalmente de HTTP a HTTPS: introduzca la dirección `https://`.
- **«certificado rechazado»**: marque **Aceptar certificados autofirmados**.
- **«no hay API de wg-easy en esta dirección»**: la dirección no es la de la
  interfaz web de wg-easy (compruebe el puerto, 51821 por defecto).
- **Un cliente sigue en «Conectado: No» con el túnel activado**: no envía nada.
  Configure un _Persistent keepalive_ (25 s) para ese cliente en wg-easy si
  quiere verlo conectado en reposo.
- **Faltan clientes**: un usuario de wg-easy que no es administrador solo ve
  sus propios clientes: use un administrador.

## Límites

- Un solo servidor wg-easy por Gladys.
- Solo wg-easy v15 y v14; las versiones anteriores no son compatibles.
- «Conectado» se deduce del último handshake (3 minutos): un cliente que no
  envía nada cuenta como desconectado, y una desconexión se ve hasta 3 minutos
  más una lectura después.
- La fecha del último handshake viene del reloj de wg-easy; los 3 minutos se
  cuentan con el de Gladys: mantenga ambos en hora (NTP).
- Los contadores de datos vuelven a cero al reiniciar wg-easy.
- La integración no crea, no borra ni renombra clientes, ni muestra su código
  QR: eso sigue en wg-easy.
- Sin relación con wg-easy ni con WireGuard. WireGuard es una marca registrada
  de Jason A. Donenfeld.
