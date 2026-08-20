import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Calendar, Clock, Users, Phone, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type Booking = {
  id: string;
  business_id: string;
  service_id: string | null;
  service_name: string;
  service_price: number;
  customer_name: string | null;
  customer_phone: string | null;
  booking_date: string | null;
  booking_time: string | null;
  duration_minutes: number | null;
  num_persons: number;
  notes: string | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  created_at: string;
};

const STATUS_CONFIG = {
  pending:   { label: 'Pendiente',  color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  confirmed: { label: 'Confirmada', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300' },
  completed: { label: 'Completada', color: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300' },
  cancelled: { label: 'Cancelada',  color: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300' },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return '—';
  return timeStr.slice(0, 5);
}

function getWeekDates(base: Date): Date[] {
  const day = base.getDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day); // adjust to Monday
  const mon = new Date(base);
  mon.setDate(base.getDate() + diff);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

export default function Agenda() {
  const { business } = useBusiness();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'week'>('list');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [weekBase, setWeekBase] = useState(new Date());

  const load = async () => {
    if (!business) return;
    const query = (supabase as any)
      .from('bookings')
      .select('*')
      .eq('business_id', business.id)
      .order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true });
    const { data } = await query;
    setBookings(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [business]);

  const updateStatus = async (id: string, status: Booking['status']) => {
    setUpdatingId(id);
    await (supabase as any).from('bookings').update({ status }).eq('id', id);
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    setUpdatingId(null);
  };

  const filtered = bookings.filter(b => {
    if (statusFilter !== 'all' && b.status !== statusFilter) return false;
    if (dateFilter && b.booking_date !== dateFilter) return false;
    return true;
  });

  const weekDates = getWeekDates(weekBase);

  const bookingsInWeek = bookings.filter(b => {
    if (!b.booking_date) return false;
    const bDate = new Date(b.booking_date + 'T00:00:00');
    return weekDates.some(d =>
      d.getFullYear() === bDate.getFullYear() &&
      d.getMonth() === bDate.getMonth() &&
      d.getDate() === bDate.getDate()
    );
  });

  const getBookingsForDay = (date: Date) =>
    bookingsInWeek.filter(b => {
      if (!b.booking_date) return false;
      const bDate = new Date(b.booking_date + 'T00:00:00');
      return bDate.getFullYear() === date.getFullYear() &&
             bDate.getMonth() === date.getMonth() &&
             bDate.getDate() === date.getDate();
    });

  const prevWeek = () => {
    const d = new Date(weekBase);
    d.setDate(d.getDate() - 7);
    setWeekBase(d);
  };

  const nextWeek = () => {
    const d = new Date(weekBase);
    d.setDate(d.getDate() + 7);
    setWeekBase(d);
  };

  const currency = business?.currency || 'USD';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '$';

  const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda de Reservas</h1>
          <p className="text-muted-foreground text-sm mt-1">{bookings.length} reservas en total</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={view === 'list' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('list')}
          >
            Lista
          </Button>
          <Button
            variant={view === 'week' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('week')}
          >
            <Calendar className="w-4 h-4 mr-1.5" /> Semana
          </Button>
        </div>
      </div>

      {/* Filters (list view only) */}
      {view === 'list' && (
        <div className="flex gap-3 flex-wrap">
          <select
            className="h-9 px-3 text-sm border border-input rounded-lg bg-background"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">Todos los estados</option>
            <option value="pending">Pendiente</option>
            <option value="confirmed">Confirmada</option>
            <option value="completed">Completada</option>
            <option value="cancelled">Cancelada</option>
          </select>
          <Input
            type="date"
            className="h-9 w-auto text-sm"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            placeholder="Filtrar por fecha"
          />
          {dateFilter && (
            <Button variant="ghost" size="sm" onClick={() => setDateFilter('')}>
              Limpiar fecha
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : view === 'week' ? (
        /* ── Week view ── */
        <div className="card-elevated p-4">
          {/* Week navigation */}
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="icon" onClick={prevWeek}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium">
              {weekDates[0].toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
              {' — '}
              {weekDates[6].toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <Button variant="ghost" size="icon" onClick={nextWeek}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {weekDates.map((date, i) => {
              const isToday = date.toDateString() === new Date().toDateString();
              const dayBookings = getBookingsForDay(date);
              return (
                <div key={i} className="min-h-[120px]">
                  <div className={cn(
                    'text-center text-xs font-medium mb-1 py-1 rounded-lg',
                    isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  )}>
                    <div>{DAY_LABELS[i]}</div>
                    <div className="text-base font-bold">{date.getDate()}</div>
                  </div>
                  <div className="space-y-1">
                    {dayBookings.map(b => (
                      <div
                        key={b.id}
                        className={cn(
                          'text-xs px-1.5 py-1 rounded-md truncate',
                          STATUS_CONFIG[b.status].color
                        )}
                        title={`${b.service_name} — ${b.customer_name || 'Cliente'} — ${formatTime(b.booking_time)}`}
                      >
                        <span className="font-medium">{formatTime(b.booking_time)}</span>
                        {' '}{b.service_name}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-elevated p-12 text-center">
          <Calendar className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">No hay reservas con estos filtros.</p>
        </div>
      ) : (
        /* ── List view ── */
        <div className="space-y-2">
          {filtered.map(booking => (
            <div key={booking.id} className="card-elevated px-4 py-3">
              <div className="flex items-start gap-3">
                {/* Date/time block */}
                <div className="flex-shrink-0 w-16 text-center bg-muted/50 rounded-lg py-2">
                  <p className="text-xs text-muted-foreground">
                    {booking.booking_date
                      ? new Date(booking.booking_date + 'T00:00:00').toLocaleDateString('es-CO', { month: 'short' }).toUpperCase()
                      : '—'}
                  </p>
                  <p className="text-xl font-bold leading-tight">
                    {booking.booking_date
                      ? new Date(booking.booking_date + 'T00:00:00').getDate()
                      : '—'}
                  </p>
                  <p className="text-xs font-medium text-primary">{formatTime(booking.booking_time)}</p>
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{booking.service_name}</p>
                      <p className="text-sm text-primary font-semibold">
                        {currencySymbol}{booking.service_price.toFixed(2)}
                      </p>
                    </div>
                    <select
                      className={cn(
                        'text-xs px-2 py-1 rounded-lg border-0 font-medium cursor-pointer',
                        STATUS_CONFIG[booking.status].color
                      )}
                      value={booking.status}
                      onChange={e => updateStatus(booking.id, e.target.value as Booking['status'])}
                      disabled={updatingId === booking.id}
                    >
                      {Object.entries(STATUS_CONFIG).map(([value, { label }]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    {booking.customer_name && (
                      <span className="font-medium text-foreground">{booking.customer_name}</span>
                    )}
                    {booking.customer_phone && (
                      <a
                        href={`https://wa.me/${booking.customer_phone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-green-700 dark:text-green-400 hover:underline"
                      >
                        <Phone className="w-3 h-3" />
                        {booking.customer_phone}
                      </a>
                    )}
                    {booking.num_persons > 1 && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {booking.num_persons} personas
                      </span>
                    )}
                    {booking.duration_minutes && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {booking.duration_minutes} min
                      </span>
                    )}
                  </div>

                  {booking.notes && (
                    <p className="text-xs text-muted-foreground mt-1 bg-muted/50 rounded px-2 py-1">
                      📝 {booking.notes}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
