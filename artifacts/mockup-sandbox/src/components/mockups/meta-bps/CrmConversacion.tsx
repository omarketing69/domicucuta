import { useState } from "react";
import {
  Bot, Send, Paperclip, Smile, CheckCheck, Circle, MoreVertical,
  Phone, Tag, Users, Megaphone, ChevronDown, Clock, Zap,
  MessageSquare, BarChart2, RefreshCw, ShieldCheck, X
} from "lucide-react";

const TEMPLATES = [
  { label: "Bienvenida", msg: "¡Hola! Bienvenido/a a Pollo Pop 🍗 ¿En qué te puedo ayudar hoy?" },
  { label: "Estado pedido", msg: "Tu pedido está en preparación 🔥 En aprox. 25 min te llega." },
  { label: "Promo del día", msg: "¡Hoy tenemos 2x1 en combos familiares! 🎉 ¿Quieres aprovechar?" },
];

const MSGS_ALL = [
  { id: 1, from: "customer", text: "Hola! Quiero hacer un pedido", time: "10:02" },
  { id: 2, from: "ai", text: "¡Hola Sara! Bienvenida a Pollo Pop 🍗 ¿Qué deseas ordenar hoy?", time: "10:02", isAI: true },
  { id: 3, from: "customer", text: "Me encantó el pedido anterior 🔥 quiero repetirlo", time: "10:10" },
  { id: 4, from: "ai", text: "¡Me alegra mucho! Tu último pedido fue:\n• Combo Familiar x1\n• Papas grandes x4\n\n¿Quieres el mismo? 😊", time: "10:10", isAI: true },
  { id: 5, from: "customer", text: "Sí! Pero agrega una bebida adicional", time: "10:12" },
  { id: 6, from: "ai", text: "¡Perfecto! Tu pedido actualizado:\n• Combo Familiar x1\n• Papas grandes x4\n• Bebida adicional x1\n\nTotal: $52.000\n\n¿Confirmo el pedido?", time: "10:12", isAI: true },
  { id: 7, from: "customer", text: "Sí confirmado, envío a Cra 15 #32-10", time: "10:13" },
];

export function CrmConversacion() {
  const [aiEnabled, setAiEnabled] = useState(true);
  const [tab, setTab] = useState<"chat" | "broadcast" | "stats">("chat");
  const [input, setInput] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">

      {/* Left: Contact info */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        {/* Contact header */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold text-base">SJ</div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Sara Jiménez</p>
              <p className="text-xs text-gray-500">+57 318 777 8888</p>
            </div>
          </div>
          {/* Tags */}
          <div className="flex flex-wrap gap-1 mb-3">
            {["VIP", "Frecuente"].map(t => (
              <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${t === "VIP" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>{t}</span>
            ))}
          </div>
          {/* Meta sync badge */}
          <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
            <span className="text-xs text-green-700 font-medium">Sincronizado con Meta BPS</span>
          </div>
        </div>

        {/* Stats */}
        <div className="p-4 border-b border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Historial</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Pedidos", value: "31" },
              { label: "Gastado", value: "$620k" },
              { label: "Último", value: "hace 6h" },
              { label: "Resp. media", value: "3 min" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 rounded-lg p-2 text-center">
                <p className="font-bold text-gray-900 text-sm">{value}</p>
                <p className="text-[10px] text-gray-400">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* AI Agent control */}
        <div className="p-4 border-b border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Agente IA Meta BPS</p>
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-600" />
                <span className="text-xs font-semibold text-purple-700">Auto-respuesta</span>
              </div>
              <button
                onClick={() => setAiEnabled(v => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${aiEnabled ? "bg-purple-500" : "bg-gray-300"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${aiEnabled ? "left-4" : "left-0.5"}`} />
              </button>
            </div>
            <p className="text-[11px] text-purple-600">
              {aiEnabled ? "El agente está respondiendo por ti automáticamente." : "Modo manual activo — tú respondes."}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Acciones</p>
          <div className="space-y-1.5">
            {[
              { icon: <Tag className="w-3.5 h-3.5" />, label: "Editar etiquetas", color: "text-orange-600 bg-orange-50 hover:bg-orange-100" },
              { icon: <Users className="w-3.5 h-3.5" />, label: "Ver perfil completo", color: "text-gray-600 bg-gray-50 hover:bg-gray-100" },
            ].map(({ icon, label, color }) => (
              <button key={label} className={`w-full flex items-center gap-2 text-xs px-2.5 py-2 rounded-lg transition-colors ${color}`}>
                {icon}{label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Center: Conversation */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        <div className="bg-white border-b border-gray-200 px-5 flex items-center gap-1 flex-shrink-0">
          {[
            { key: "chat", label: "Conversación", icon: <MessageSquare className="w-3.5 h-3.5" /> },
            { key: "broadcast", label: "Envío masivo", icon: <Megaphone className="w-3.5 h-3.5" /> },
            { key: "stats", label: "Estadísticas", icon: <BarChart2 className="w-3.5 h-3.5" /> },
          ].map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key as typeof tab)}
              className={`flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors ${tab === key ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
            >
              {icon}{label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 py-2">
            {aiEnabled && (
              <div className="flex items-center gap-1.5 bg-purple-50 border border-purple-200 rounded-full px-2.5 py-1 text-[11px] text-purple-700 font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                IA respondiendo
              </div>
            )}
          </div>
        </div>

        {/* TAB: Chat */}
        {tab === "chat" && (
          <>
            {aiEnabled && (
              <div className="bg-purple-50 border-b border-purple-100 px-5 py-2 flex items-center gap-2 flex-shrink-0">
                <Bot className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-xs text-purple-700">El <strong>Agente IA de Meta BPS</strong> está manejando esta conversación</span>
                <button onClick={() => setAiEnabled(false)} className="ml-auto text-xs text-purple-600 underline">Tomar control</button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {MSGS_ALL.map(msg => (
                <div key={msg.id} className={`flex ${msg.from === "customer" ? "justify-start" : "justify-end"}`}>
                  {msg.from !== "customer" ? (
                    <div className="flex flex-col items-end gap-1 max-w-sm">
                      {msg.isAI && (
                        <div className="flex items-center gap-1 text-[10px] text-purple-500 mr-1">
                          <Bot className="w-3 h-3" />Agente IA
                        </div>
                      )}
                      <div className={`px-3 py-2 rounded-2xl rounded-tr-sm text-sm leading-relaxed ${msg.isAI ? "bg-purple-500 text-white" : "bg-orange-500 text-white"}`}>
                        {msg.text.split("\n").map((l, i) => <p key={i}>{l}</p>)}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-400 mr-1">
                        {msg.time} <CheckCheck className="w-3 h-3 text-blue-400" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-1 max-w-sm">
                      <div className="px-3 py-2 rounded-2xl rounded-tl-sm bg-white border border-gray-200 text-sm text-gray-800">
                        {msg.text}
                      </div>
                      <p className="text-[10px] text-gray-400 ml-1">{msg.time}</p>
                    </div>
                  )}
                </div>
              ))}
              {aiEnabled && (
                <div className="flex justify-end">
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1 text-[10px] text-purple-500">
                      <Bot className="w-3 h-3" />Agente IA escribiendo...
                    </div>
                    <div className="bg-purple-500 px-3 py-2 rounded-2xl rounded-tr-sm">
                      <div className="flex gap-1">
                        {[0,1,2].map(i => (
                          <span key={i} className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* Input */}
            <div className="bg-white border-t border-gray-200 px-5 py-3 flex-shrink-0">
              {/* Templates */}
              {showTemplates && (
                <div className="mb-3 border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-600">Plantillas rápidas</p>
                    <button onClick={() => setShowTemplates(false)}><X className="w-3.5 h-3.5 text-gray-400" /></button>
                  </div>
                  {TEMPLATES.map(t => (
                    <button key={t.label} onClick={() => { setInput(t.msg); setShowTemplates(false); }} className="w-full text-left px-3 py-2 hover:bg-orange-50 transition-colors border-b border-gray-100 last:border-0">
                      <p className="text-xs font-semibold text-gray-700">{t.label}</p>
                      <p className="text-[11px] text-gray-400 truncate">{t.msg}</p>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                <button onClick={() => setShowTemplates(v => !v)} className="text-gray-400 hover:text-orange-500 transition-colors">
                  <Zap className="w-4 h-4" />
                </button>
                <button className="text-gray-400 hover:text-gray-600"><Smile className="w-4 h-4" /></button>
                <button className="text-gray-400 hover:text-gray-600"><Paperclip className="w-4 h-4" /></button>
                <input value={input} onChange={e => setInput(e.target.value)} placeholder={aiEnabled ? "Escribe para interrumpir al agente IA..." : "Escribe un mensaje..."} className="flex-1 bg-transparent text-sm outline-none text-gray-700 placeholder-gray-400" />
                <button className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${input ? "bg-green-500 text-white" : "bg-gray-200 text-gray-400"}`}>
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        )}

        {/* TAB: Broadcast */}
        {tab === "broadcast" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-lg mx-auto">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-5 flex items-start gap-3">
                <Megaphone className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-orange-800">Envío masivo vía Meta BPS</p>
                  <p className="text-xs text-orange-600 mt-1">Envía mensajes a múltiples clientes simultáneamente usando la API de WhatsApp Business. No requiere intervención manual.</p>
                </div>
              </div>
              {/* Segment selector */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                <p className="text-sm font-semibold text-gray-800 mb-3">Segmento de clientes</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "VIP", count: 8, color: "border-violet-300 bg-violet-50 text-violet-700" },
                    { label: "Frecuentes", count: 24, color: "border-blue-300 bg-blue-50 text-blue-700" },
                    { label: "Inactivos", count: 15, color: "border-gray-300 bg-gray-50 text-gray-600" },
                    { label: "Todos", count: 47, color: "border-orange-300 bg-orange-50 text-orange-700" },
                  ].map(({ label, count, color }) => (
                    <button key={label} className={`flex items-center justify-between px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${color}`}>
                      <span>{label}</span>
                      <span className="text-xs opacity-70">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Message */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                <p className="text-sm font-semibold text-gray-800 mb-2">Mensaje</p>
                <textarea
                  value={broadcastText}
                  onChange={e => setBroadcastText(e.target.value)}
                  rows={4}
                  placeholder="Escribe tu mensaje aquí... Usa {{nombre}} para personalizar."
                  className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-300 resize-none"
                />
                <div className="flex items-center gap-2 mt-2">
                  {TEMPLATES.map(t => (
                    <button key={t.label} onClick={() => setBroadcastText(t.msg)} className="text-[11px] px-2 py-1 rounded-full bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors">
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setSent(true)}
                className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-600 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Send className="w-4 h-4" />
                {sent ? "¡Enviado! 47 mensajes en cola" : "Enviar a 47 contactos vía WhatsApp"}
              </button>
            </div>
          </div>
        )}

        {/* TAB: Stats */}
        {tab === "stats" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-lg mx-auto space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Mensajes hoy", value: "127", change: "+12%", up: true },
                  { label: "Respondidos IA", value: "89%", change: "tasa", up: true },
                  { label: "Tiempo resp.", value: "< 1 min", change: "meta BPS", up: true },
                ].map(({ label, value, change }) => (
                  <div key={label} className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                    <p className="font-bold text-gray-900 text-lg">{value}</p>
                    <p className="text-[10px] text-gray-400">{label}</p>
                    <p className="text-[10px] text-green-500 mt-0.5">{change}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-800 mb-3">Actividad por hora (hoy)</p>
                <div className="flex items-end gap-1 h-20">
                  {[3,7,12,5,9,15,18,22,14,8,6,4].map((v, i) => (
                    <div key={i} className="flex-1 rounded-t-sm bg-orange-200 hover:bg-orange-400 transition-colors cursor-pointer" style={{ height: `${(v/22)*100}%` }} />
                  ))}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-gray-400">8am</span>
                  <span className="text-[10px] text-gray-400">8pm</span>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-800 mb-3">Difusiones recientes</p>
                <div className="space-y-2">
                  {[
                    { label: "Promo fines de semana", date: "hace 2 días", delivered: 41, opened: 35 },
                    { label: "Recordatorio inactivos", date: "hace 1 semana", delivered: 15, opened: 9 },
                  ].map(({ label, date, delivered, opened }) => (
                    <div key={label} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <p className="text-xs font-medium text-gray-700">{label}</p>
                        <p className="text-[10px] text-gray-400">{date}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-gray-800">{delivered} entregados</p>
                        <p className="text-[10px] text-green-600">{opened} abiertos ({Math.round(opened/delivered*100)}%)</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
