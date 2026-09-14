-- ============================================================
-- 0016_email_provider_id.sql
-- Id del envío que devuelve Resend, para poder rastrear un mail.
--
-- email_events.status = 'sent' significa solamente que Resend ACEPTÓ
-- el envío, no que el mail se haya entregado. La diferencia importa:
-- con el remitente de prueba (onboarding@resend.dev) Resend acepta
-- todo y solo entrega a la dirección dueña de la cuenta, así que un
-- mail a un cliente real queda como "sent" sin haber llegado nunca.
--
-- Guardando el id se puede buscar ese envío puntual en el panel de
-- Resend y ver qué pasó de verdad (entregado, rebotado, filtrado).
-- Sin esto, un "no me llegó el mail" no se puede investigar.
-- ============================================================

alter table email_events
  add column provider_message_id text;

comment on column email_events.provider_message_id is
  'Id que devolvió Resend al aceptar el envío. Sirve para buscarlo en su panel: status=sent solo indica que Resend lo aceptó, no que se entregó.';

-- Para encontrar un envío puntual cuando alguien reporta que no le
-- llegó y solo se tiene el id del mail.
create index idx_email_events_provider_message on email_events(provider_message_id);
