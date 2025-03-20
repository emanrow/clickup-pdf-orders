<template>
  <div class="app">
    <h1>ClickUp OAuth with Vue.js</h1>
    <button @click="authenticate">Log in with ClickUp</button>
    <button :disabled="!isLoggedIn" @click="fetchData">Fetch ClickUp Data</button>
    <button :disabled="!isLoggedIn" @click="loadTasks">Generate Title Order</button>

    <pre v-if="clickupData">{{ clickupData }}</pre>

    <!-- Dropdown Menu -->
    <div v-if="tasks.length" class="dropdown">
      <select v-model="selectedTaskId" @change="showTaskModal">
        <option disabled value="">Select a task</option>
        <option v-for="task in tasks" :key="task.id" :value="task.id">
          {{ task.name }}
        </option>
      </select>
    </div>

    <!-- Modal -->
    <TaskModal 
      :is-open="isModalOpen"
      :task="selectedTaskObject"
      @close="closeModal"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import TaskModal from './components/TaskModal.vue';

const clickupData = ref(null);
const tasks = ref([]);
const selectedTaskId = ref('');
const selectedTask = ref<any>(null);
const selectedTaskObject = ref(null);

const isModalOpen = ref(false);
const isLoggedIn = ref(false);

const authenticate = () => {
  window.location.href = 'http://localhost:3000/api/auth';
};

const fetchData = async () => {
  try {
    const response = await axios.get('http://localhost:3000/api/data');
    clickupData.value = response.data;
    isLoggedIn.value = true;
  } catch (error) {
    console.error('Error fetching data:', error);
    isLoggedIn.value = false;
  }
};

const loadTasks = async () => {
  try {
    const response = await axios.get('http://localhost:3000/api/titleorder/tasks');
    tasks.value = response.data;
    isLoggedIn.value = true;
  } catch (error) {
    console.error('Error loading tasks:', error);
    isLoggedIn.value = false;
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
    await fetchData();
  } else {
    // Attempt a quick auth check
    try {
      await axios.get('http://localhost:3000/api/data');
      isLoggedIn.value = true;
    } catch {
      isLoggedIn.value = false;
    }
  }
});
</script>

<style scoped>
.app {
  font-family: Arial, sans-serif;
  text-align: center;
  margin-top: 2rem;
}

button {
  margin: 0.5rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
}

button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.dropdown {
  margin-top: 1rem;
}

select {
  padding: 0.5rem;
  font-size: 1rem;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
}

.modal-content {
  background: #fff;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
  width: 500px;
  max-height: 80vh;
  overflow-y: auto;
}
</style>
