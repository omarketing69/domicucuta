/**
 * business-calendar-ics — Supabase Edge Function
 *
 * Read-only iCal (.ics) feed of a reservations-mode business's confirmed
 * bookings. This is the cheap alternative to a per-tenant Google Calendar
 * OAuth integration: the owner pastes this URL once into Google Calendar
 * ("Other calendars → From URL") and sees their bookings on their phone,
 * with zero OAuth, zero Google Cloud setup, and no token to keep alive.
 *
 * Public, unauthenticated (Google's calendar polling can't carry a login) —
 * business_id is an unguessable UUID, the same protection level the rest
 * of the app already relies on for code-based lookups.
 *
 * GET ?business_id=<uuid>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Floating local time (no Z/TZID) — matches the wall-clock time the
// business and its customers already agreed on, same as displaying it
// plainly in Agenda.tsx.
function toIcsDateTime(date: string, time: string): string {
  const datePart = date.replace(/-/g, '');
  const timePart = time.replace(/:/g, '').slice(0, 6).padEnd(6, '0');
  return `${datePart}T${timePart}`;
}

function addMinutes(date: string, time: string, minutes: number): string {
  const [h, m, s] = time.split(':').map(Number);
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCHours(h || 0, (m || 0) + minutes, s || 0, 0);
  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  const hh = String(base.getUTCHours()).padStart(2, '0');
  const mi = String(base.getUTCMinutes()).padStart(2, '0');
  const ss = String(base.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const businessId = url.searchParams.get('business_id');
  if (!businessId) {
    return new Response('Missing business_id', { status: 400, headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: business } = await supabaseAdmin
    .from('businesses')
    .select('id, name, business_type, is_active')
    .eq('id', businessId)
    .eq('is_active', true)
    .eq('business_type', 'reservations')
    .maybeSingle();

  if (!business) {
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, service_name, customer_name, customer_phone, booking_date, booking_time, duration_minutes, notes, updated_at')
    .eq('business_id', businessId)
    .eq('status', 'confirmed')
    .gte('booking_date', sevenDaysAgo)
    .order('booking_date', { ascending: true });

  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const events = (bookings ?? []).map((b) => {
    const duration = b.duration_minutes ?? 60;
    const dtstart = toIcsDateTime(b.booking_date, b.booking_time);
    const dtend = addMinutes(b.booking_date, b.booking_time, duration);
    const summary = icsEscape(`${b.service_name}${b.customer_name ? ' — ' + b.customer_name : ''}`);
    const descriptionParts = [
      b.customer_phone ? `Tel: ${b.customer_phone}` : null,
      b.notes ? `Notas: ${b.notes}` : null,
    ].filter(Boolean);
    const description = icsEscape(descriptionParts.join('\\n'));

    return [
      'BEGIN:VEVENT',
      `UID:${b.id}@whatorden`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${summary}`,
      description ? `DESCRIPTION:${description}` : null,
      'END:VEVENT',
    ].filter(Boolean).join('\r\n');
  });

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WhatOrden//Reservas//ES',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(business.name + ' — Reservas')}`,
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(ics, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
});
