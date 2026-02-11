const express = require("express");
const path = require("path");
const ImapFlow = require("imapflow").Client;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

/* ================= CONFIGURACIÓN TOTAL ================= */
const EMAIL_USER = "digitalesservicios311@gmail.com"; 
const EMAIL_PASS = "iyxjnaadfsbrsjl"; 

// Filtros de frases obligatorias para evitar correos basura de publicidad
const REQUIRED_PHRASES = [
  "código", "hogar", "viaje", "temporal", "acceso", "confirmar"
];
/* ======================================================== */

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
        let lock = await client.getMailboxLock("INBOX");
        
        let emails = [];
        
        // Buscamos en los últimos 15 correos para mayor margen
        for await (let message of client.listMessages("INBOX", { seq: "1:15" }, { source: true, envelope: true })) {
            let subject = message.envelope.subject || "";
            let from = message.envelope.from[0].address || "";
            let subjectLower = subject.toLowerCase();
            
            // FILTRO 1: Solo Netflix
            if (from.toLowerCase().includes("netflix")) {
                let rawHtml = message.source.toString();
                let htmlLower = rawHtml.toLowerCase();

                // FILTRO 2: Solo si contiene frases de códigos o hogar
                const match = REQUIRED_PHRASES.some(phrase => 
                    subjectLower.includes(phrase) || htmlLower.includes(phrase)
                );

                if (match) {
                    // LIMPIEZA DE HTML: Quitamos scripts y estilos que rompen el diseño móvil
                    let cleanHtml = rawHtml
                        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
                        .replace(/<a /gi, '<a style="display:none" ') // Ocultar links para evitar clics accidentales
                        .replace(/width="[6-9][0-9]{2}"/gi, 'width="100%"'); // Ajustar tablas anchas

                    emails.push({
                        subject: subject,
                        date: message.envelope.date.toLocaleString('es-ES', { timeZone: 'UTC' }),
                        html: cleanHtml
                    });
                }
            }
        }

        lock.release();
        await client.logout();

        // Ordenar para que el más reciente salga primero
        emails.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({ emails });

    } catch (error) {
        console.error("ERROR CRÍTICO:", error);
        res.status(500).json({ error: "Fallo en servidor: " + error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor filtrado listo para digitalesservicios311@gmail.com`);
});
