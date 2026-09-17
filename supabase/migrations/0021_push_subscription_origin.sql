-- ============================================================
-- 0021_push_subscription_origin.sql
-- De qué dirección salió cada suscripción push.
--
-- Una suscripción hecha en un preview de Vercel queda atada a ESE deploy:
-- sus avisos salen con el icono y los links de esa copia, no del sitio
-- real. Pasó y costó entenderlo, porque en la lista de dispositivos las
-- dos suscripciones se veían iguales.
--
-- Guardando el origen, la pantalla de Notificaciones puede marcar las que
-- vienen de una copia de prueba para darlas de baja.
-- ============================================================

alter table push_subscriptions
  add column origin text;

comment on column push_subscriptions.origin is
  'Dirección desde la que se activó (https://casa-periotti.vercel.app, un preview, localhost). Los avisos salen con el icono y los links de esa copia.';
