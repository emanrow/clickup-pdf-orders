<template>
  <div class="app">
    <header class="header">
      <h1>📄 Title Order Sheets</h1>
      <p class="subtitle">
        Generate Title Report Order Sheet PDFs straight from ClickUp.
      </p>
    </header>

    <!-- Checking session -->
    <section v-if="authState === 'checking'" class="panel">
      <p class="muted">Checking your session…</p>
    </section>

    <!-- Logged out: walkthrough + login -->
    <section v-else-if="authState === 'loggedOut'" class="panel">
      <h2>How it works</h2>
      <ol class="steps">
        <li>
          <strong>Log in with ClickUp.</strong>
          You'll be sent to ClickUp to authorize this tool with your own
          account — it can only see what you can see in ClickUp.
        </li>
        <li>
          <strong>Pick a Title Order.</strong>
          Choose an order sheet task from the Title Orders list. The tool
          pulls its Title Scope, E&amp;Rs, and linked parcels live from
          ClickUp.
        </li>
        <li>
          <strong>Review &amp; download.</strong>
          Double-check the order details and parcel table, then download the
          finished PDF order sheet — ready to send to the title company.
        </li>
      </ol>
      <button class="primary" @click="authenticate">Log in with ClickUp</button>
      <p v-if="authError" class="error">{{ authError }}</p>
    </section>

    <!-- Logged in: pick an order -->
    <section v-else class="panel">
      <p class="signed-in">
        Signed in as <strong>{{ username || 'ClickUp user' }}</strong>
      </p>

      <div v-if="tasksLoading" class="muted">Loading Title Orders…</div>

      <template v-else-if="tasks.length">
        <label class="picker-label" for="order-picker">
          Select a Title Order to review and download its order sheet:
        </label>
        <div class="picker-row">
          <select id="order-picker" v-model="selectedTaskId" @change="showTaskModal">
            <option disabled value="">Select a Title Order…</option>
            <option v-for="task in tasks" :key="task.id" :value="task.id">
              {{ task.name }}
            </option>
          </select>
          <button title="Reload the list from ClickUp" @click="loadTasks">⟳ Refresh</button>
        </div>
        <p class="hint">
          Selecting an order opens a preview with its parcels, Title Scope,
          and E&amp;Rs, plus a <em>Download PDF</em> button.
        </p>
      </template>

      <template v-else>
        <p class="muted">
          No Title Orders found{{ tasksError ? ` — ${tasksError}` : '.' }}
        </p>
        <button @click="loadTasks">⟳ Try again</button>
      </template>
    </section>

    <!-- Modal -->
    <TaskModal
      :is-open="isModalOpen"
      :task="selectedTaskObject"
      @close="closeModal"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import axios from 'axios';
import TaskModal from './components/TaskModal.vue';
import { API_URL } from './config.js';

const authState = ref<'checking' | 'loggedOut' | 'loggedIn'>('checking');
const authError = ref('');
const username = ref('');

const tasks = ref<any[]>([]);
const tasksLoading = ref(false);
const tasksError = ref('');

const selectedTaskId = ref('');
const selectedTaskObject = ref<any>(null);
const isModalOpen = ref(false);

const authenticate = () => {
  window.location.href = `${API_URL}/api/auth`;
};

const checkSession = async () => {
  try {
    const response = await axios.get(`${API_URL}/api/data`);
    username.value = response.data?.user?.username || '';
    authState.value = 'loggedIn';
    await loadTasks();
  } catch {
    authState.value = 'loggedOut';
  }
};

const loadTasks = async () => {
  tasksLoading.value = true;
  tasksError.value = '';
  try {
    const response = await axios.get(`${API_URL}/api/titleorder/tasks`);
    tasks.value = response.data;
  } catch (error) {
    console.error('Error loading tasks:', error);
    tasks.value = [];
    tasksError.value = 'could not load the list from ClickUp';
  } finally {
    tasksLoading.value = false;
  }
};

const showTaskModal = () => {
  selectedTaskObject.value = tasks.value.find(task => task.id === selectedTaskId.value);
  isModalOpen.value = true;
};

const closeModal = () => {
  isModalOpen.value = false;
  selectedTaskId.value = '';
};

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auth') === 'success') {
    // Clean the ?auth=success out of the address bar
    window.history.replaceState({}, '', window.location.pathname);
  }
  await checkSession();
});
</script>

<style scoped>
.app {
  font-family: inherit;
  max-width: 640px;
  margin: 0 auto;
  text-align: center;
}

.header h1 {
  margin-bottom: 0.25rem;
}

.subtitle {
  color: #aaa;
  margin-top: 0;
  font-size: 1.1rem;
}

.panel {
  background-color: #1a1a1a;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 1.5rem 2rem;
  margin-top: 1.5rem;
  text-align: left;
}

.panel h2 {
  margin-top: 0;
  text-align: center;
}

.steps {
  padding-left: 1.25rem;
  margin-bottom: 1.5rem;
}

.steps li {
  margin-bottom: 0.75rem;
}

.primary {
  display: block;
  margin: 0 auto;
  background-color: #4a5ad1;
  font-size: 1.05rem;
}

.primary:hover {
  border-color: #aab2ff;
}

.signed-in {
  margin-top: 0;
  color: #aaa;
  text-align: center;
}

.picker-label {
  display: block;
  margin-bottom: 0.5rem;
}

.picker-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.picker-row select {
  flex: 1;
  padding: 0.5rem;
  font-size: 1rem;
  border-radius: 8px;
  background-color: #242424;
  color: inherit;
  border: 1px solid #444;
}

.hint {
  color: #888;
  font-size: 0.9rem;
}

.muted {
  color: #aaa;
}

.error {
  color: #ff6b6b;
}
</style>
