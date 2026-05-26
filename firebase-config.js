// Firebase configuration — replace with your Firebase project config
// Get these values from: Firebase Console > Project Settings > General > Your apps > Web app
const firebaseConfig = {
    apiKey: "AIzaSyD5xni-Ou_yqFJvHNUdZkPR-I0xktPRAAM",
    authDomain: "financial-tracker-3d5f0.firebaseapp.com",
    projectId: "financial-tracker-3d5f0",
    storageBucket: "financial-tracker-3d5f0.firebasestorage.app",
    messagingSenderId: "389503949121",
    appId: "1:389503949121:web:9ae3bdeaeca18a3292e9c0"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Enable offline persistence so writes queue locally and sync when online
db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
    if (err.code === 'failed-precondition') {
        console.warn('Offline persistence unavailable: multiple tabs open');
    } else if (err.code === 'unimplemented') {
        console.warn('Offline persistence not supported by this browser');
    }
});
