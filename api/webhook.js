export default async function handler(req, res) {
    if (req.method === 'POST') {
        const body = req.body;

        // Cek jika trigger-nya dari tombol website Anda
        if (body && body.aksi === 'kirim_wa') {
            const nomorTujuan = "6285650956877"; // <--- MASUKKAN NOMOR ANDA
            const apiKey = "apicoid_live_w95eyThfnTHYoX0TPS0wKz40HjGNLtDJdXE1TDbRiRc"; // <--- MASUKKAN API KEY ANDA

            try {
                // Server Vercel menembak API Api.co.id (Aman dari CORS browser!)
                const response = await fetch("https://api.api.co.id/v1/messages", { 
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + apiKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        to: nomorTujuan,
                        type: "text",
                        text: {
                            body: "Halo! Pesan ini sukses dikirim aman dari backend Vercel aurofa.com 🚀"
                        }
                    })
                });

                if (response.ok) {
                    return res.status(200).json({ status: "Pesan WA berhasil dikirim via Backend!" });
                } else {
                    const errorText = await response.text();
                    return res.status(500).json({ status: "Gagal dikirim oleh API WA: " + errorText });
                }
            } catch (err) {
                return res.status(500).json({ status: "Error sistem backend: " + err.message });
            }
        }

        // Ini bagian menerima data dari Webhook eksternal (WA masuk)
        console.log("Ada data webhook masuk:", body);
        return res.status(200).json({ status: 'Webhook received!' });
        
    } else {
        return res.status(200).send('Jalur Backend Aurofa aktif!');
    }
}
