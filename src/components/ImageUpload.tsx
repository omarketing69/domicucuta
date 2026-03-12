import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, X, Image } from 'lucide-react';

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  folder?: string;
}

export function ImageUpload({ value, onChange, folder = 'misc' }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Por favor selecciona una imagen válida.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('La imagen no puede superar 5 MB.');
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error } = await supabase.storage
        .from('images')
        .upload(filename, file, { upsert: false });

      if (error) throw error;

      const { data } = supabase.storage.from('images').getPublicUrl(filename);
      onChange(data.publicUrl);
    } catch (err) {
      console.error('Error uploading image:', err);
      alert('Error al subir la imagen. Intenta de nuevo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />

      {value ? (
        <div className="relative w-full h-40 rounded-lg overflow-hidden border border-border group">
          <img
            src={value}
            alt="Imagen del producto"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Cambiar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => onChange('')}
              disabled={uploading}
            >
              <X className="w-3.5 h-3.5" />
              Quitar
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-32 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/30 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">Subiendo...</span>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Image className="w-5 h-5" />
              </div>
              <span className="text-sm font-medium">Subir imagen</span>
              <span className="text-xs">JPG, PNG, WEBP · Máx 5 MB</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
