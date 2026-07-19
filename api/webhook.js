import { kv } from '@vercel/kv';

// Helper: dapatkan access token baru dari refresh token
async function getGoogleAccessToken() {
    const params = new URLSearchParams();
    params.append('client_id', process.env.GOOGLE_CLIENT_ID);
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET);
    params.append('refresh_token', process.env.GOOGLE_REFRESH_TOKEN);
    params.append('grant_type', 'refresh_token');

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString() // Wajib diubah ke string (.toString())
    });

    const data = await response.json();

    // Log ini untuk debugging jika proses refresh token-nya yang gagal
    if (!response.ok) {
        console.error("❌ Gagal mendapatkan Access Token:", JSON.stringify(data));
        return null;
    }

    return data.access_token;
}

// Helper: buat event di Google Calendar (sudah bisa undang peserta)
async function buatEventCalendar({ judul, tanggal, jam_mulai, jam_selesai, attendees }) {
    const accessToken = await getGoogleAccessToken();
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    // Ubah daftar email jadi format yang diminta Google: [{ email: "..." }, ...]
    const attendeesList = (attendees || []).map(email => ({ email }));

    // sendUpdates=all -> supaya Google otomatis kirim email undangan ke peserta
    const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
        {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                summary: judul,
                start: { dateTime: `${tanggal}T${jam_mulai}:00`, timeZone: 'Asia/Jakarta' },
                end: { dateTime: `${tanggal}T${jam_selesai}:00`, timeZone: 'Asia/Jakarta' },
                attendees: attendeesList
            })
        }
    );
    return await response.json();
}

export default async function handler(req, res) {
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

    if (req.method === 'POST') {
        const body = req.body;
        const changeValue = body?.entry?.[0]?.changes?.[0]?.value;

        if (changeValue && changeValue.statuses) {
            return res.status(200).json({ status: 'Status update diabaikan' });
        }

        if (changeValue && changeValue.messages?.[0]) {
            const messageData = changeValue.messages[0];
            const nomorPengirim = messageData.from;
            const teksMasuk = messageData.text?.body;

            if (!teksMasuk) {
                return res.status(200).json({ status: 'Bukan teks' });
            }

            const metaAccessToken = process.env.META_ACCESS_TOKEN;
            const metaPhoneNumberId = "1187789877749779";
            const groqApiKey = process.env.GROQ_API_KEY;
            const historyKey = `chat_history:${nomorPengirim}`;

            try {
                if (teksMasuk.trim().toLowerCase() === 'reset') {
                    await kv.del(historyKey);
                    await kirimWA(metaAccessToken, metaPhoneNumberId, nomorPengirim, "Oke, percakapan sudah direset.");
                    return res.status(200).json({ status: 'Chat direset' });
                }

                let history = await kv.get(historyKey) || [];
                history.push({ role: "user", content: teksMasuk });
                if (history.length > 10) history = history.slice(-10);

                // Tanggal hari ini untuk konteks AI (biar paham "besok", "lusa", dll)
                const sekarang = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
                const hariIni = new Date(sekarang).toISOString().split('T')[0];

                const tools = [{
                    type: "function",
                    function: {
                        name: "buat_jadwal_calendar",
                        description: "Membuat/menjadwalkan event baru di Google Calendar user, bisa juga mengundang peserta lain lewat email",
                        parameters: {
                            type: "object",
                            properties: {
                                judul: { type: "string", description: "Judul atau nama acara/meeting" },
                                tanggal: { type: "string", description: "Tanggal acara, format YYYY-MM-DD" },
                                jam_mulai: { type: "string", description: "Jam mulai, format HH:MM 24 jam" },
                                jam_selesai: { type: "string", description: "Jam selesai, format HH:MM 24 jam" },
                                attendees: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Daftar alamat email peserta yang diundang ke acara ini, kalau ada disebutkan dalam pesan user"
                                }
                            },
                            required: ["judul", "tanggal", "jam_mulai", "jam_selesai"]
                        }
                    }
                }];

                const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + groqApiKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "llama-3.1-8b-instant",
                        messages: [
                            {
                                role: "system",
                                content: `Kamu adalah Aurora AI Agent. Jawab pesan dengan ramah dan singkat. Hari ini tanggal ${hariIni} (zona waktu Asia/Jakarta).

Kalau user minta dibuatkan jadwal/meeting/acara, LANGSUNG panggil function buat_jadwal_calendar tanpa perlu bertanya balik, selama judul, tanggal, dan jam sudah jelas. Hitung tanggal absolut sendiri kalau user bilang "besok"/"lusa"/"hari ini"/dll berdasarkan tanggal hari ini.

Parameter attendees BERSIFAT OPSIONAL. Kalau user TIDAK menyebutkan email siapapun, panggil function itu TANPA parameter attendees sama sekali (jangan tanya balik "siapa yang diundang", jangan menunda pembuatan jadwal). Attendees hanya diisi KALAU user secara eksplisit menyebutkan alamat email orang yang mau diundang.`
                            },
                            ...history
                        ],
                        tools: tools,
                        tool_choice: "auto"
                    })
                });

                const groqData = await groqResponse.json();
                if (!groqResponse.ok) console.error("❌ Groq error:", JSON.stringify(groqData));

                const pesanAI = groqData.choices?.[0]?.message;
                let balasanFinal;

                // CEK APAKAH AI MEMANGGIL FUNCTION BUAT JADWAL
                if (pesanAI?.tool_calls?.[0]) {
                    const toolCall = pesanAI.tool_calls[0];
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log("-> AI minta buat jadwal:", args);

                    const hasilCalendar = await buatEventCalendar(args);

                    if (hasilCalendar.id) {
                        const daftarPeserta = (args.attendees && args.attendees.length > 0)
                            ? `\n👥 Mengundang: ${args.attendees.join(', ')}`
                            : '';

                        balasanFinal = `✅ Jadwal berhasil dibuat!\n\n📌 ${args.judul}\n📅 ${args.tanggal}\n⏰ ${args.jam_mulai} - ${args.jam_selesai} WIB${daftarPeserta}`;
                    } else {
                        console.error("❌ Gagal buat event:", JSON.stringify(hasilCalendar));
                        balasanFinal = "Maaf, gagal membuat jadwal di Calendar. Coba lagi ya.";
                    }
                } else {
                    balasanFinal = pesanAI?.content || "Maaf, Aurora AI sedang mengalami gangguan teknis.";
                }

                history.push({ role: "assistant", content: balasanFinal });
                await kv.set(historyKey, history);

                await kirimWA(metaAccessToken, metaPhoneNumberId, nomorPengirim, balasanFinal);

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

// Helper kirim pesan WA (biar tidak duplikat kode)
async function kirimWA(token, phoneNumberId, to, teks) {
    const response = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "text",
            text: { body: teks }
        })
    });
    return await response.json();
}
