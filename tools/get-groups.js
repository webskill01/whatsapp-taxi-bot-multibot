import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
   
   const { state } = await useMultiFileAuthState('./bots/bot-delhi/baileys_auth');
   const sock = makeWASocket({ auth: state });
   
   sock.ev.on('connection.update', async (update) => {
     if (update.connection === 'open') {
       const groups = await sock.groupFetchAllParticipating();
       console.log(JSON.stringify(Object.values(groups).map(g => ({
         id: g.id,
         name: g.subject
       })), null, 2));
       process.exit(0);
     }
   });