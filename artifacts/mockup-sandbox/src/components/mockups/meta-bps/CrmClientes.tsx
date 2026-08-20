import { useState } from "react";
import {
  MessageCircle, Search, Phone, Tag, Star, Clock, Bot, Send,
  ChevronRight, Wifi, Users, TrendingUp, Zap, X, Paperclip,
  Smile, MoreVertical, CheckCheck, Circle, ArrowLeft
} from "lucide-react";

const CUSTOMERS = [
  { id: 1, name: "María González", phone: "+57 300 123 4567", tags: ["VIP", "Frecuente"], lastOrder: "hace 2 h", orders: 14, avatar: "MG", connected: true, unread: 2, lastMsg: "¿Tienen el combo familiar disponible?" },
  { id: 2, name: "Carlos Pérez", phone: "+57 315 987 6543", tags: ["Frecuente"], lastOrder: "hace 1 día", orders: 8, avatar: "CP", connected: true, unread: 0, lastMsg: "Perfecto, gracias 👍" },
  { id: 3, name: "Laura Ríos", phone: "+57 321 456 7890", tags: ["Nueva zona"], lastOrder: "hace 3 días", orders: 2, avatar: "LR", connected: false, unread: 1, lastMsg: "¿Cuánto demora el domicilio?" },
  { id: 4, name: "Andrés Molina", phone: "+57 304 222 3333", tags: ["Corporativo"], lastOrder: "hace 5 días", orders: 22, avatar: "AM", connected: true, unread: 0, lastMsg: "Necesito factura por favor" },
  { id: 5, name: "Sara Jiménez", phone: "+57 318 777 8888", tags: ["VIP", "Frecuente"], lastOrder: "hace 6 h", orders: 31, avatar: "SJ", connected: true, unread: 3, lastMsg: "Me encantó el pedido anterior 🔥" },
  { id: 6, name: "Diego Vargas", phone: "+57 312 555 4444", tags: ["Inactivo"], lastOrder: "hace 2 meses", orders: 3, avatar: "DV", connected: false, unread: 0, lastMsg: "Ok, entendido" },
];

const MESSAGES = [
  { id: 1, from: "customer", text: "Hola! Quiero hacer un pedido", time: "10:02", read: true },
  { id: 2, from: "ai", text: "¡Hola María! Bienvenida a Pollo Pop 🍗 Puedes ver nuestro menú en el link de tu perfil. ¿Qué deseas ordenar?", time: "10:02", read: true, isAI: true },
  { id: 3, from: "customer", text: "¿Tienen el combo familiar disponible?", time: "10:15", read: true },
  { id: 4, from: "ai", text: "¡Claro que sí! El Combo Familiar incluye:\n• 1 pollo entero\n• 4 papas medianas\n• 4 bebidas\nPor solo $45.000 🎉", time: "10:15", read: true, isAI: true },
  { id: 5, from: "customer", text: "Perfecto! Lo quiero con entrega a domicilio", time: "10:18", read: false },
];

const TAG_COLORS: Record<string, string> = {
  VIP: "bg-violet-100 text-violet-700",
  Frecuente: "bg-blue-100 text-blue-700",
  Inactivo: "bg-gray-100 text-gray-500",
  "Nueva zona": "bg-green-100 text-green-700",
  Corporativo: "bg-orange-100 text-orange-700",
};

export function CrmClientes() {
  const [selected, setSelected] = useState<typeof CUSTOMERS[0] | null>(CUSTOMERS[0]);
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);

  const filtered = CUSTOMERS.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">

      {/* ── Sidebar nav ── */}
      <aside className="w-14 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-5 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
          <span className="text-white text-xs font-bold">PP</span>
        </div>
        <div className="flex flex-col gap-3 mt-4">
          {[
            { icon: <TrendingUp className="w-4 h-4" />, active: false },
            { icon: <Users className="w-4 h-4" />, active: true },
            { icon: <MessageCircle className="w-4 h-4" />, active: false },
            { icon: <Zap className="w-4 h-4" />, active: false },
          ].map((item, i) => (
            <button key={i} className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${item.active ? "bg-orange-50 text-orange-600" : "text-gray-400 hover:text-gray-600"}`}>
              {item.icon}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Customer list ── */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">Clientes</h2>
            <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-green-700 font-medium">Meta BPS</span>
            </div>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar cliente..."
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-orange-300"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`w-full px-3 py-2.5 flex items-start gap-2.5 border-b border-gray-50 transition-colors text-left ${selected?.id === c.id ? "bg-orange-50" : "hover:bg-gray-50"}`}
            >
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xs font-bold">
                  {c.avatar}
                </div>
                {c.connected && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-900 truncate">{c.name}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">{c.lastOrder}</span>
                </div>
                <p className="text-[11px] text-gray-500 truncate mt-0.5">{c.lastMsg}</p>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex gap-1 flex-wrap">
                    {c.tags.slice(0, 1).map(t => (
                      <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TAG_COLORS[t]}`}>{t}</span>
                    ))}
                  </div>
                  {c.unread > 0 && (
                    <span className="w-4 h-4 rounded-full bg-green-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {c.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Conversation panel ── */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Contact header */}
          <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-sm font-bold">
                  {selected.avatar}
                </div>
                {selected.connected && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm">{selected.name}</p>
                  <div className="flex gap-1">
                    {selected.tags.map(t => (
                      <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TAG_COLORS[t]}`}>{t}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Phone className="w-3 h-3" />{selected.phone}
                  </span>
                  <span className="text-xs text-gray-500">{selected.orders} pedidos</span>
                  {selected.connected && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <Wifi className="w-3 h-3" />Sincronizado con Meta
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* AI toggle */}
              <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-full px-3 py-1.5">
                <Bot className="w-3.5 h-3.5 text-purple-600" />
                <span className="text-xs font-medium text-purple-700">Agente IA</span>
                <button
                  onClick={() => setAiEnabled(v => !v)}
                  className={`relative w-8 h-4 rounded-full transition-colors ${aiEnabled ? "bg-purple-500" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${aiEnabled ? "left-4" : "left-0.5"}`} />
                </button>
              </div>
              <button className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500">
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* AI status bar */}
          {aiEnabled && (
            <div className="bg-purple-50 border-b border-purple-100 px-5 py-2 flex items-center gap-2">
              <Bot className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-xs text-purple-700">El <strong>Agente IA de Meta BPS</strong> está respondiendo automáticamente a este cliente</span>
              <span className="ml-auto text-xs text-purple-500 underline cursor-pointer">Tomar control</span>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {MESSAGES.map(msg => (
              <div key={msg.id} className={`flex ${msg.from === "customer" ? "justify-start" : "justify-end"}`}>
                {msg.from !== "customer" && (
                  <div className="flex flex-col items-end gap-1 max-w-xs">
                    {msg.isAI && (
                      <div className="flex items-center gap-1 text-[10px] text-purple-500 mr-1">
                        <Bot className="w-3 h-3" />Agente IA
                      </div>
                    )}
                    <div className={`px-3 py-2 rounded-2xl rounded-tr-sm text-sm ${msg.isAI ? "bg-purple-500 text-white" : "bg-orange-500 text-white"}`}>
                      {msg.text.split("\n").map((line, i) => <p key={i}>{line}</p>)}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-gray-400 mr-1">
                      {msg.time}
                      <CheckCheck className="w-3 h-3 text-blue-400" />
                    </div>
                  </div>
                )}
                {msg.from === "customer" && (
                  <div className="flex flex-col items-start gap-1 max-w-xs">
                    <div className="px-3 py-2 rounded-2xl rounded-tl-sm bg-white border border-gray-200 text-sm text-gray-800">
                      {msg.text}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-gray-400 ml-1">
                      {msg.time}
                      {!msg.read && <Circle className="w-2 h-2 fill-green-500 text-green-500" />}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {/* Typing indicator */}
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
          <div className="bg-white border-t border-gray-200 px-4 py-3 flex-shrink-0">
            {aiEnabled && (
              <p className="text-[11px] text-purple-500 mb-2 flex items-center gap-1">
                <Bot className="w-3 h-3" />El agente IA está a cargo — escribe para tomar el control manualmente
              </p>
            )}
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <button className="text-gray-400 hover:text-gray-600"><Smile className="w-4 h-4" /></button>
              <button className="text-gray-400 hover:text-gray-600"><Paperclip className="w-4 h-4" /></button>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={aiEnabled ? "Escribe para interrumpir al agente IA..." : "Escribe un mensaje..."}
                className="flex-1 bg-transparent text-sm outline-none text-gray-700 placeholder-gray-400"
              />
              <button className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${input ? "bg-green-500 text-white" : "bg-gray-200 text-gray-400"}`}>
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Selecciona un cliente</p>
          </div>
        </div>
      )}

      {/* ── Right panel: customer stats ── */}
      {selected && (
        <div className="w-56 bg-white border-l border-gray-200 flex flex-col flex-shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Resumen</p>
            <div className="space-y-2">
              {[
                { label: "Pedidos totales", value: selected.orders },
                { label: "Último pedido", value: selected.lastOrder },
                { label: "Etiquetas", value: selected.tags.join(", ") },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] text-gray-400">{label}</p>
                  <p className="text-xs font-medium text-gray-800">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="p-4 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Meta BPS</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">Estado WA</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${selected.connected ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {selected.connected ? "Activo" : "Sin WA"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">Agente IA</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${aiEnabled ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500"}`}>
                  {aiEnabled ? "Activo" : "Manual"}
                </span>
              </div>
            </div>
          </div>
          <div className="p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Acciones rápidas</p>
            <div className="space-y-1.5">
              <button className="w-full text-left text-xs px-2.5 py-2 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors flex items-center gap-2">
                <MessageCircle className="w-3.5 h-3.5" />Enviar difusión
              </button>
              <button className="w-full text-left text-xs px-2.5 py-2 rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors flex items-center gap-2">
                <Tag className="w-3.5 h-3.5" />Editar etiquetas
              </button>
              <button className="w-full text-left text-xs px-2.5 py-2 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors flex items-center gap-2">
                <Star className="w-3.5 h-3.5" />Marcar VIP
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
