import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'
import express from 'express'
import cors from 'cors'

// ======================
// CONFIG
// ======================
const PORT = process.env.PORT || 3000
const LINK_CARDAPIO =
  process.env.LINK_CARDAPIO || 'https://SEU-LINK-DO-CARDAPIO.com'

// Mensagens automáticas
const MENSAGEM_SAUDACAO = `👋 Olá! Seja bem-vindo(a) 😄
Sou o atendimento automático da *Dominus Food*.`

const MENSAGEM_CARDAPIO = `📖 *Nosso Cardápio Digital*
👉 ${LINK_CARDAPIO}

Fique à vontade para escolher e me dizer o que deseja pedir 😋`

const MENSAGENS_STATUS = {
  EM_PREPARO: '🕑 Seu pedido está em preparo.',
  PRONTO: '✅ Seu pedido está pronto!',
  SAIU_PARA_ENTREGA: '🚚 Seu pedido saiu para entrega.',
  FINALIZADO: '🙏 Pedido finalizado. Obrigado pela preferência!'
}

// ======================
// APP
// ======================
const app = express()
app.use(cors())
app.use(express.json())

let sock = null

// Controle simples de primeira mensagem
const contatosAtendidos = new Set()

// ======================
// WHATSAPP
// ======================
async function iniciarWhatsApp() {
  try {
    console.log('🔄 Iniciando conexão com WhatsApp...')

    const { state, saveCreds } = await useMultiFileAuthState('./auth')

    sock = makeWASocket({
      auth: state,
      browser: ['DominusFood', 'Chrome', '1.0.0'],
      printQRInTerminal: true // ✅ QR em blocos no terminal
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut

        console.error('❌ Conexão caiu. Reconectar?', shouldReconnect)

        if (shouldReconnect) {
          setTimeout(iniciarWhatsApp, 5000)
        }
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp conectado com sucesso!')
      }
    })

    // ======================
    // MENSAGENS RECEBIDAS
    // ======================
    sock.ev.on('messages.upsert', async ({ messages }) => {
      try {
        const msg = messages?.[0]
        if (!msg?.message) return
        if (msg.key.fromMe) return

        const jid = msg.key.remoteJid
        if (!jid || !jid.endsWith('@s.whatsapp.net')) return

        // Primeira mensagem do cliente
        if (contatosAtendidos.has(jid)) return
        contatosAtendidos.add(jid)

        console.log('📥 Novo contato:', jid)

        await sock.sendMessage(jid, { text: MENSAGEM_SAUDACAO })
        await new Promise(r => setTimeout(r, 1000))
        await sock.sendMessage(jid, { text: MENSAGEM_CARDAPIO })

        console.log('📤 Saudação + cardápio enviados')
      } catch (err) {
        console.error('❌ Erro ao processar mensagem recebida', err)
      }
    })
  } catch (err) {
    console.error('🔥 Erro crítico ao iniciar WhatsApp', err)
    setTimeout(iniciarWhatsApp, 5000)
  }
}

iniciarWhatsApp()

// ======================
// WEBHOOK DO GERENCIADOR
// ======================
app.post('/pedido', async (req, res) => {
  try {
    if (!sock) {
      return res.json({ ok: false, error: 'WhatsApp não conectado' })
    }

    console.log('📦 Webhook recebido:', req.body)

    const { status, cliente, pedido } = req.body

    if (!status || !cliente?.telefone) {
      return res.json({ ok: false, error: 'Dados obrigatórios ausentes' })
    }

    const mensagemStatus = MENSAGENS_STATUS[status]
    if (!mensagemStatus) {
      return res.json({ ok: false, error: 'Status inválido' })
    }

    const jid = `${cliente.telefone}@s.whatsapp.net`
    const nomeCliente = cliente.nome ? `Olá ${cliente.nome} 👋\n` : ''
    const numeroPedido = pedido?.numero
      ? `Pedido ${pedido.numero}\n\n`
      : ''

    await sock.sendMessage(jid, {
      text: `${nomeCliente}${numeroPedido}${mensagemStatus}`
    })

    console.log('📤 Status enviado:', status)
    res.json({ ok: true })
  } catch (err) {
    console.error('❌ Erro no webhook /pedido', err)
    res.json({ ok: false })
  }
})

// ======================
app.listen(PORT, () => {
  console.log(`🚀 Webhook ativo na porta ${PORT}`)
})
