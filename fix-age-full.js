const fs = require("fs");
let content = fs.readFileSync("public/age-verification.html", "utf8");

// Replace everything from <script> to </script>
const scriptStart = content.indexOf("<script>");
const scriptEnd = content.indexOf("</script>") + 9;

const newScript = `<script>
        const API = 'https://rodeo-fresh-production-7348.up.railway.app/api';
        let token = '';
        let approvedCount = 0;

        window.onload = async function() {
            token = localStorage.getItem('auth_token');
            if (!token) {
                window.location.href = 'login.html';
                return;
            }
            console.log('Logged in');
            loadApprovedCount();
            setupNFC();
        };

        async function loadApprovedCount() {
            try {
                const r = await fetch(API + '/wristbands', {
                    headers: {'Authorization': 'Bearer ' + token}
                });
                const bands = await r.json();
                const today = new Date().toISOString().split('T')[0];
                approvedCount = bands.filter(b => {
                    if (!b.approved_date) return false;
                    return new Date(b.approved_date).toISOString().split('T')[0] === today && b.alcohol_approved;
                }).length;
                updateCount();
            } catch(err) {
                console.error('Error loading count:', err);
            }
        }

        function updateCount() {
            document.getElementById('approvedCount').textContent = approvedCount + ' Approved Today';
        }

        // Manual/USB input
        document.getElementById('wristbandId').addEventListener('keydown', async function(e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const uid = this.value.trim().toUpperCase();
            if (uid) await approveWristband(uid);
        });

        // NFC setup
        function setupNFC() {
            if ('NDEFReader' in window) {
                const nfcBtn = document.createElement('button');
                nfcBtn.id = 'nfcStartBtn';
                nfcBtn.innerHTML = '?? Tap Here to Enable NFC Scanning';
                nfcBtn.style.cssText = 'width:100%;padding:20px;font-size:18px;font-weight:bold;background:#00B74A;color:white;border:none;border-radius:15px;margin-top:15px;cursor:pointer;';
                document.getElementById('scanCard').querySelector('.input-group').appendChild(nfcBtn);
                nfcBtn.addEventListener('click', async function() {
                    try {
                        const ndef = new NDEFReader();
                        await ndef.scan();
                        nfcBtn.innerHTML = '? NFC Active - Tap Wristband Now';
                        nfcBtn.style.background = '#2d7a4f';
                        ndef.onreading = async (event) => {
                            const uid = event.serialNumber.replace(/:/g, '').toUpperCase();
                            console.log("NFC tag read:", uid);
                            document.getElementById('wristbandId').value = uid;
                            await approveWristband(uid);
                        };
                        ndef.onreadingerror = () => {
                            console.log("NFC read error - try again");
                        };
                    } catch(err) {
                        nfcBtn.innerHTML = '? NFC Failed: ' + err.message;
                        nfcBtn.style.background = '#e53e3e';
                    }
                });
            }
        }

        async function approveWristband(uid) {
            if (!uid) return;
            console.log('Approving wristband:', uid);
            try {
                const r = await fetch(API + '/wristbands/approve-age', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ rfid_uid: uid })
                });
                const d = await r.json();
                if (r.ok) {
                    showApproved(d.wristband);
                    approvedCount++;
                    updateCount();
                    setTimeout(reset, 3000);
                } else {
                    showMessage('? ' + d.error, 'error');
                    document.getElementById('wristbandId').value = '';
                    document.getElementById('wristbandId').focus();
                }
            } catch(err) {
                console.error('Approval error:', err);
                showMessage('? Error approving wristband', 'error');
                document.getElementById('wristbandId').value = '';
                document.getElementById('wristbandId').focus();
            }
        }

        function showApproved(band) {
            document.getElementById('personInfo').innerHTML =
                '<h3>? APPROVED FOR ALCOHOL</h3>' +
                '<div class="info-row"><span class="info-label">Customer:</span><span class="info-value">' + (band.customer_name || 'N/A') + '</span></div>' +
                '<div class="info-row"><span class="info-label">Wristband:</span><span class="info-value">' + band.rfid_uid + '</span></div>' +
                '<div class="info-row"><span class="info-label">Type:</span><span class="info-value">' + (band.ticket_type || 'adult') + '</span></div>' +
                '<div class="info-row"><span class="info-label">Status:</span><span class="info-value" style="color:#00B74A;">? 19+ VERIFIED</span></div>';
            document.getElementById('scanCard').classList.add('hidden');
            document.getElementById('approvedCard').classList.remove('hidden');
            showMessage('? Wristband approved! Can purchase bar credits.', 'success');
        }

        function reset() {
            document.getElementById('scanCard').classList.remove('hidden');
            document.getElementById('approvedCard').classList.add('hidden');
            document.getElementById('wristbandId').value = '';
            document.getElementById('wristbandId').focus();
            clearMessage();
        }

        function showMessage(msg, type) {
            document.getElementById('alertContainer').innerHTML = '<div class="alert alert-' + type + '">' + msg + '</div>';
        }

        function clearMessage() {
            document.getElementById('alertContainer').innerHTML = '';
        }
    </script>`;

content = content.substring(0, scriptStart) + newScript + content.substring(scriptEnd);
fs.writeFileSync("public/age-verification.html", content, "utf8");
console.log("Done - full script replaced");
