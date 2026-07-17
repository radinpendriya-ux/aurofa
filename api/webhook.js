export default async function handler(req, res) {
    // 1. VERIFIKASI WEBHOOK DARI META (Permintaan GET)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        const VERIFY_TOKEN = "MY_VERIFY_TOKEN_AUROFA";

        if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
            return res.status(200).send(challenge);
        }
        return res.status(200).send('Jalur Webhook Aktif!');
    }

    // 2. PROSES TERIMA DATA DARI META (Permintaan POST)
    if (req.method === 'POST') {
        const body = req.body;

        // Cetak data mentah yang masuk dari Meta ke Vercel Logs biar gampang kita pantau
        console.log("=== DATA MASUK DARI META ===");
        console.log(JSON.stringify(body, null, 2));

        // Ambil data value perubahan dari WhatsApp
        const changeValue = body?.entry?.[0]?.changes?.[0]?.value;

        // JIKA YANG MASUK ADALAH STATUS PESAN (Delivered / Read), ABAIKAN AGAR TIDAK LOOPING
        if (changeValue && changeValue.statuses) {
            console.log("-> Ini adalah update status pengiriman pesan (Delivered/Read). Diabaikan.");
            return res.status(200).json({ status: 'Status update diabaikan' });
        }

        // JIKA YANG MASUK ADALAH PESAN TEKS BARU (Ada objek messages)
        if (changeValue && changeValue.messages?.[0]) {
            const messageData = changeValue.messages[0];
            const nomorPengirim = messageData.from; // Nomor WA Anda
            const teksMasuk = messageData.text?.body; // Isi chat Anda

            console.log(`-> Menemukan Chat Masuk dari ${nomorPengirim}: "${teksMasuk}"`);

            if (!teksMasuk) {
                console.log("-> Chat masuk bukan bertipe teks. Diabaikan.");
                return res.status(200).json({ status: 'Bukan teks' });
            }

            // KONFIGURASI KUNCI UTAMA (Membaca dari Environment Variables Vercel)
            const metaAccessToken = process.env.META_ACCESS_TOKEN;
            const metaPhoneNumberId = "1187789877749779"; 
            const groqApiKey = process.env.GROQ_API_KEY;

            try {
                console.log("-> Menghubungi Groq AI...");
                // A. TANYA KE GROQ AI
                const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + groqApiKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "llama3-8b-8192",
                        messages: [
                            { role: "system", content: "Kamu adalah Aurora AI Agent. Jawablah pesan customer dengan ramah, singkat, dan solutif." },
                            { role: "user", content: teksMasuk }
                        ]
                    })
                });

                const groqData = await groqResponse.json();
                const jawabanAI = groqData.choices?.[0]?.message?.content || "Maaf, Aurora AI sedang mengalami gangguan teknis.";
                console.log("-> Jawaban Groq AI:", jawabanAI);

                console.log("-> Mengirim balasan kembali ke WhatsApp Anda...");
                // B. BALAS CHAT KE WHATSAPP PENGIRIM
                const sendWaResponse = await fetch(`https://graph.facebook.com/v25.0/${metaPhoneNumberId}/messages`, {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + metaAccessToken,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        messaging_product: "whatsapp",
                        recipient_type: "individual",
                        to: nomorPengirim,
                        type: "text",
                        text: { body: jawabanAI }
                    })
                });

                const sendWaData = await sendWaResponse.json();
                console.log("-> Status Kirim Balasan WhatsApp:", JSON.stringify(sendWaData));

                return res.status(200).json({ status: 'Sukses' });

            } catch (err) {
                console.error("❌ ERROR PROSES:", err.message);
                return res.status(500).json({ error: err.message });
            }
        }

        return res.status(200).json({ status: 'Format data tidak dikenal/tidak diproses' });
    }

    return res.status(405).send('Method Not Allowed');
}
