const express = require("express");
const path = require("path");
const { ImapFlow } = require("imapflow"); // Importación corregida

const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, "public")));

/* ================= CONFIGURACIÓN INTEGRADA ================= */
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "iyxjnaadfsbrsjl"; 

// Frases para filtrar correos que realmente sean de códigos o acceso
const REQUIRED_PHRASES = [
  "código", "hogar", "viaje", "temporal", "acceso", "confirmar", "iniciar sesión"
];
/* =========================================================== */

app.get("/api/emails", async (req, res) => {
    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        },
        logger: false
    });

    try {
        await client.connect();
        
        // Bloqueamos la bandeja de entrada para leer
        let lock = await client.getMailboxLock("INBOX");
        
        let emails = [];
        
        // Buscamos en los últimos 15 correos
        for await (let message of client.listMessages("INBOX", { seq: "1:15" }, { source: true, envelope: true })) {
            let subject = message.envelope.subject || "";
            let from = message.envelope.from[0].address || "";
            let subjectLower = subject.toLowerCase();
            
            // FILTRO 1: Solo remitentes de Netflix
            if (from.toLowerCase().includes("netflix")) {
                let rawHtml = message.source.toString();
                let htmlLower = rawHtml.toLowerCase();

                // FILTRO 2: Solo si contiene frases clave de acceso
                const match = REQUIRED_PHRASES.some(phrase => 
                    subjectLower.includes(phrase) || htmlLower.includes(phrase)
                );

                if (match) {
                    // Limpieza básica para que no se rompa el diseño en móviles
                    let cleanHtml = rawHtml
                        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
                        .replace(/width="[6-9][0-9]{2}"/gi, 'width="100%"');

                    emails.push({
                        subject: subject,
                        date: message.envelope.date.toLocaleString('es-ES'),
                        html: cleanHtml
                    });
                }
            }
        }

        lock.release();
        await client.logout();

        // Ordenar por fecha (más reciente primero)
        emails.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({ emails });

    } catch (error) {
        console.error("ERROR EN EL SERVIDOR:", error);
        res.status(500).json({ error: "Error de conexión con Gmail: " + error.message });
    }
});

// Arrancar el servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor funcionando correctamente en el puerto ${PORT}`);
    console.log(`📧 Conectado a: ${EMAIL_USER}`);
});
