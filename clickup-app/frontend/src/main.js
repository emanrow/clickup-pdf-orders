import { createApp } from 'vue'
import axios from 'axios'
import './style.css'
import App from './App.vue'

// Auth token lives in an httpOnly cookie; send it on cross-origin dev requests
axios.defaults.withCredentials = true

createApp(App).mount('#app')
