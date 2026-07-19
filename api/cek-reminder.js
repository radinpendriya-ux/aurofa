import { kv } from '@vercel/kv';

// Helper: dapatkan access token baru dari refresh token (sama seperti di webhook.js)
async function getGoogleAccessToken() {
    const params = new URLSearchParams();
    params.append('client_id', process.env.GOOGLE_CLIENT_ID);
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET);
    params.append('refresh_token', process.env.GOOGLE_REFRESH_TOKEN);
    params.append('grant_type', 'refresh_token');

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });

    const data = await response.json();
    if (!response.ok) {
        console.error("❌ Gagal ambil Access Token:", JSON.stringify(data));
        return null;
    }
    return data.access_token;
}

// Helper: kirim pesan WA (sama seperti di webhook.js)
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

export default async function handler(req, res) {
    // Proteksi: hanya bisa dipanggil kalau tahu secret key-nya
    // Panggil endpoint ini seperti: https://www.aurofa.com/api/cek-reminder?key=SECRET_KAMU
    const secretKey = req.query.key;
    if (secretKey !== process.env.CRON_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const accessToken = await getGoogleAccessToken();
        if (!accessToken) {
            return res.status(500).json({ error: 'Gagal ambil access token Google' });
        }

        const calendarId = process.env.GOOGLE_CALENDAR_ID;
        const sekarang = new Date();
        const batasAtas = new Date(sekarang.getTime() + 35 * 60000); // cek 35 menit ke depan

        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${sekarang.toISOString()}&timeMax=${batasAtas.toISOString()}&singleEvents=true&orderBy=startTime`;

        const calendarResponse = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });
        const calendarData = await calendarResponse.json();

        if (!calendarResponse.ok) {
            console.error("❌ Gagal ambil event calendar:", JSON.stringify(calendarData));
            return res.status(500).json({ error: 'Gagal ambil data calendar' });
        }

        const events = calendarData.items || [];
        let jumlahDikirim = 0;

        for (const event of events) {
            const mulai = event.start?.dateTime;
            if (!mulai) continue; // lewati event "sehari penuh" yang tidak punya jam spesifik

            const waktuMulai = new Date(mulai);
            const menitLagi = Math.round((waktuMulai - sekarang) / 60000);

            // Cuma proses event yang mulai sekitar 25-35 menit lagi
            if (menitLagi >= 25 && menitLagi <= 35) {
                const reminderKey = `reminded:${event.id}`;
                const sudahDikirim = await kv.get(reminderKey);

                if (!sudahDikirim) {
                    const jamMulai = waktuMulai.toLocaleTimeString('id-ID', {
                        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
                    });

                    const pesanReminder = `⏰ Reminder!\n\nAcara "${event.summary}" akan dimulai jam ${jamMulai} WIB (sekitar 30 menit lagi).`;

                    await kirimWA(
                        process.env.META_ACCESS_TOKEN,
                        "1187789877749779",
                        process.env.NOMOR_HP_SAYA,
                        pesanReminder
                    );

                    // Tandai sudah dikirim, simpan 1 hari biar database tidak numpuk
                    await kv.set(reminderKey, true, { ex: 86400 });
                    jumlahDikirim++;
                }
            }
        }

        return res.status(200).json({
            status: 'OK',
            event_dicek: events.length,
            reminder_dikirim: jumlahDikirim
        });

    } catch (err) {
        console.error("❌ ERROR CEK REMINDER:", err.message);
        return res.status(500).json({ error: err.message });
    }
}
