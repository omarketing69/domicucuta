import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';

const schema = z.object({
  email: z.string().email('Email inválido').or(z.literal('')),
  password: z.string().min(6, 'Mínimo 6 caracteres').or(z.literal('')),
}).refine(d => d.email || d.password, {
  message: 'Debes ingresar al menos un campo para actualizar',
  path: ['email'],
});

type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessName: string;
  ownerId: string;
  currentEmail?: string;
}

export default function EditCredentialsDialog({ open, onOpenChange, businessName, ownerId, currentEmail }: Props) {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: currentEmail ?? '', password: '' },
  });

  // Reset form with current email when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v) form.reset({ email: currentEmail ?? '', password: '' });
    onOpenChange(v);
  };

  const onSubmit = async (values: FormData) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = `https://${projectId}.supabase.co/functions/v1/update-client-credentials`;

      const payload: Record<string, string> = { targetUserId: ownerId };
      if (values.email) payload.email = values.email;
      if (values.password) payload.password = values.password;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? 'Error al actualizar credenciales');
        return;
      }

      toast.success(`✅ Credenciales de "${businessName}" actualizadas`);
      form.reset({ email: values.email, password: '' });
      onOpenChange(false);
    } catch {
      toast.error('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar credenciales</DialogTitle>
          <DialogDescription>
            Modifica el email y/o contraseña de acceso para <strong>{businessName}</strong>. Deja en blanco lo que no quieras cambiar.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">

            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="cliente@email.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Nueva contraseña <span className="text-muted-foreground font-normal">(opcional)</span></FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Dejar vacío para no cambiar"
                      {...field}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
