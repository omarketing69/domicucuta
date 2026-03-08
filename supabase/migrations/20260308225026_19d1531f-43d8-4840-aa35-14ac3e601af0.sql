
-- Permitir al super admin ver todos los negocios
CREATE POLICY "Admins can view all businesses"
  ON public.businesses FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Permitir al super admin actualizar negocios (ej. activar/desactivar)
CREATE POLICY "Admins can update all businesses"
  ON public.businesses FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
