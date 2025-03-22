<template>
    <div v-if="isOpen" class="modal-overlay" @click.self="close">
        <div id="order-sheet" class="modal-content">
            <h2>{{ orderData?.orderTask.name }}</h2>

            <div class="order-details" v-if="orderData">
                <h3>Order Sheet Info</h3>
                <table class="order-info-table">
                <tbody>
                    <!-- <tr><td><strong>Client:</strong></td><td>{{ getCustomField('🏢 Client') }}</td></tr> -->
                    <tr><td><strong>Date Ordered:</strong></td><td>{{ formatDate(getCustomField('📅 Date Ordered')) }}</td></tr>
                    <!-- <tr><td><strong>Date Requested by Client:</strong></td><td>{{ formatDate(getCustomField('📅 Date Requested by Client')) }}</td></tr> -->
                    <tr><td><strong>Title Scope:</strong></td><td>{{ formatArray(orderData.titleScopeDescriptions) }}</td></tr>
                    <tr><td><strong>E&Rs:</strong></td><td>{{ formatArray(orderData.erScopeDescriptions) }}</td></tr>
                    <tr><td><strong>Delivery Email:</strong></td><td>{{ getCustomField('📨 Delivery email') }}</td></tr>
                    <tr><td><strong>Include Property Profile?</strong></td><td>{{ getCustomField('🗺️ Include Property Profile Report?') ? 'Yes' : 'No' }}</td></tr>
                    <tr><td><strong>Delivery Instructions:</strong></td><td>{{ getCustomField('Delivery Instructions') }}</td></tr>
                </tbody>
                </table>

                <h3>Parcels on Order Sheet</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Parcel Name</th>
                            <th>Parcel ID</th>
                            <th>Address</th>
                            <th>County, ST</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="parcel in orderData.parcels" :key="parcel.id">
                            <td>{{ parcel.name }}</td>
                            <td>{{ getParcelField(parcel, 'Parcel_ID') }}</td>
                            <td>{{ getParcelField(parcel, 'Property Address') }}</td>
                            <td>{{ getParcelField(parcel, 'County, ST') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <button class="action-button" @click="generatePDF">Download PDF</button>
            <button class="close-button" @click="close">Close</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import axios from 'axios';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";


const props = defineProps<{ isOpen: boolean; task: any }>();
const emit = defineEmits(['close']);

const orderData = ref<any>(null);

const fetchOrderData = async () => {
    try {
        const response = await axios.get(`http://localhost:3000/api/ordersheet/${props.task.id}/full`);
        console.log('Raw API Response:', response.data);
        orderData.value = response.data;
    } catch (error) {
        console.error('Error fetching order data:', error);
    }
};

watch(() => props.isOpen, (open) => {
    if (open && props.task) {
        fetchOrderData();
    }
});

const close = () => {
    emit('close');
    orderData.value = null;
};

const getCustomField = (name: string) => {
    const field = orderData.value?.orderTask?.custom_fields.find((f: any) => f.name.includes(name.trim()));

    if (!field || field.value === undefined || field.value === null) return "—";

    if (field.type === "drop_down" || field.type === "list_relationship") {
        return field.value.name ?? "—"; // Ensure we use the proper name property
    }

    return field.value;
};

const getParcelField = (parcel: any, fieldName: string) => {
    const field = parcel.custom_fields.find((f: any) => f.name.includes(fieldName.trim()));

    if (!field) return '—';

    // Check if it's a structured address object
    if (fieldName.includes("Property Address") && typeof field.value === "object") {
        return field.value.formatted_address || "—";
    }

    return field.value ?? "—";
};

const formatDate = (timestamp: string | number) => {
    if (!timestamp) return '—';
    const tsNum = Number(timestamp);
    if (isNaN(tsNum)) return '—';
    const date = new Date(tsNum);
    return date.toLocaleDateString();
};

const formatArray = (arr: string[] | undefined) => {
    if (!arr || arr.length === 0) return "—";
    return arr.join(", ");
};

const generatePDF = async () => {
    try {
        console.log("Sending request to generate PDF...");
        
        // Get Title Scope and E&Rs names from the task's custom fields
        const titleScopeField = orderData.value?.orderTask?.custom_fields.find((f: any) => f.name.includes('Title Scope'));
        const erScopeField = orderData.value?.orderTask?.custom_fields.find((f: any) => f.name.includes('E&Rs'));
        
        const titleScopeNames = titleScopeField?.value?.map((item: any) => item.name) || [];
        const erScopeNames = erScopeField?.value?.map((item: any) => item.name) || [];

        const response = await axios.post(
            'http://localhost:3000/api/generate-pdf',
            {
                title: orderData.value.orderTask.name,
                date_ordered: formatDate(getCustomField("📅 Date Ordered")),
                titleScopeNames,
                titleScopeDescriptions: orderData.value.titleScopeDescriptions,
                erScopeNames,
                erScopeDescriptions: orderData.value.erScopeDescriptions,
                include_property_profile: getCustomField("🗺️ Include Property Profile Report?") ? "Yes" : "No",
                delivery_instructions: getCustomField("Delivery Instructions"),
                delivery_email: getCustomField("📨 Delivery email"),
                parcels: orderData.value.parcels.map(parcel => ({
                    name: parcel.name,
                    parcel_id: getParcelField(parcel, "Parcel_ID"),
                    address: getParcelField(parcel, "Property Address"),
                    county_st: getParcelField(parcel, "County, ST")
                }))
            },
            { responseType: 'blob' }
        );

        console.log("Received PDF response. Creating download link...");

        // Extract filename from Content-Disposition header
        const contentDisposition = response.headers['content-disposition'];
        const filenameMatch = contentDisposition && contentDisposition.match(/filename="(.+)"/);
        const filename = filenameMatch ? filenameMatch[1] : 'output.pdf';

        const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error("Error generating PDF:", error);
    }
};



</script>

<style scoped>
.modal-overlay {
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
}

.modal-content {
    background-color: #1a1a1a;
    padding: 2rem;
    border-radius: 8px;
    max-width: 800px;
    max-height: 90vh;
    overflow-y: auto;
    color: white;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

.order-details ul {
    text-align: left;
}

.order-details li {
    margin-bottom: 0.5rem;
}

.order-info-table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

.order-info-table th,
.order-info-table td {
  padding: 0.5rem;
  text-align: left;
  border: none;
}

.order-info-table td:first-child {
  text-align: right;
  padding-right: 1rem;
}

.order-info-table td:last-child {
  text-align: left;
}

/* Parcels table styles */
.order-details table:not(.order-info-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

.order-details table:not(.order-info-table) th,
.order-details table:not(.order-info-table) td {
  padding: 0.5rem;
  text-align: left;
  border: 1px solid #444;
}

.order-details table:not(.order-info-table) th {
  background-color: #333;
  font-weight: bold;
}

.order-details table:not(.order-info-table) tr:nth-child(even) {
  background-color: #2a2a2a;
}

.action-button, .close-button {
    background-color: #333;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    cursor: pointer;
    border-radius: 4px;
    margin-top: 1rem;
}

.action-button:hover, .close-button:hover {
    background-color: #444;
}
</style>
