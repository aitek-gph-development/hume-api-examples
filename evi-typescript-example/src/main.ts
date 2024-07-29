import {
  Hume,
  HumeClient,
  convertBlobToBase64,
  convertBase64ToBlob,
  ensureSingleValidAudioTrack,
  getAudioStream,
  getBrowserSupportedMimeType,
  MimeType,
} from 'hume';
import './styles.css';

(async () => {
  const toggleBtn = document.querySelector<HTMLButtonElement>('button#toggle-btn');
  const chat = document.querySelector<HTMLDivElement>('div#chat');

  toggleBtn?.addEventListener('click', handleToggle);

  let client: HumeClient | null = null;
  let socket: Hume.empathicVoice.chat.ChatSocket | null = null;
  let connected = false;
  let recorder: MediaRecorder | null = null;
  let audioStream: MediaStream | null = null;
  let currentAudio: HTMLAudioElement | null = null;
  let isPlaying = false;
  let resumeChats = true;
  let chatGroupId: string | undefined;
  const audioQueue: Blob[] = [];
  const mimeType: MimeType = (() => {
    const result = getBrowserSupportedMimeType();
    return result.success ? result.mimeType : MimeType.WEBM;
  })();

  async function handleToggle(): Promise<void> {
    if (connected) {
      disconnect();
    } else {
      await connect();
    }
  }

  async function connect(): Promise<void> {
    if (!client) {
      client = new HumeClient({
        apiKey: import.meta.env.VITE_HUME_API_KEY || '',
        secretKey: import.meta.env.VITE_HUME_SECRET_KEY || '',
      });
    }

    socket = await client.empathicVoice.chat.connect({
      configId: import.meta.env.VITE_HUME_CONFIG_ID || null,
      resumedChatGroupId: chatGroupId,
    });

    socket.on('open', handleWebSocketOpenEvent);
    socket.on('message', handleWebSocketMessageEvent);
    socket.on('error', handleWebSocketErrorEvent);
    socket.on('close', handleWebSocketCloseEvent);

    toggleBtn?.classList.add('connected');
  }

  function disconnect(): void {
    toggleBtn?.classList.remove('connected');

    stopAudio();

    recorder?.stop();
    recorder = null;
    audioStream = null;

    connected = false;

    if (!resumeChats) {
      chatGroupId = undefined;
    }

    socket?.close();
  }

  async function captureAudio(): Promise<void> {
    audioStream = await getAudioStream();
    ensureSingleValidAudioTrack(audioStream);

    recorder = new MediaRecorder(audioStream, { mimeType });

    recorder.ondataavailable = async ({ data }) => {
      if (data.size < 1) return;

      const encodedAudioData = await convertBlobToBase64(data);

      const audioInput: Omit<Hume.empathicVoice.AudioInput, 'type'> = {
        data: encodedAudioData,
      };

      socket?.sendAudioInput(audioInput);
    };

    const timeSlice = 100;
    recorder.start(timeSlice);
  }

  function playAudio(): void {
    if (!audioQueue.length || isPlaying) return;

    isPlaying = true;

    const audioBlob = audioQueue.shift();

    if (!audioBlob) return;

    const audioUrl = URL.createObjectURL(audioBlob);
    currentAudio = new Audio(audioUrl);

    currentAudio.play();

    currentAudio.onended = () => {
      isPlaying = false;

      if (audioQueue.length) playAudio();
    };
  }

  function stopAudio(): void {
    currentAudio?.pause();
    currentAudio = null;

    isPlaying = false;

    audioQueue.length = 0;
  }

  async function handleWebSocketOpenEvent(): Promise<void> {
    console.log('Web socket connection opened');

    connected = true;

    await captureAudio();
  }

  async function handleWebSocketMessageEvent(
    message: Hume.empathicVoice.SubscribeEvent
  ): Promise<void> {
    switch (message.type) {
      case 'chat_metadata':
        chatGroupId = message.chatGroupId;
        break;

      case 'user_message':
      case 'assistant_message':
        const { role, content } = message.message;
        const topThreeEmotions = extractTopThreeEmotions(message);
        appendMessage(role, content ?? '', topThreeEmotions);
        break;

      case 'audio_output':
        const audioOutput = message.data;
        const blob = convertBase64ToBlob(audioOutput, mimeType);

        audioQueue.push(blob);

        if (audioQueue.length >= 1) playAudio();
        break;

      case 'user_interruption':
        stopAudio();
        break;
    }
  }

  function handleWebSocketErrorEvent(error: Error): void {
    console.error(error);
  }

  async function handleWebSocketCloseEvent(): Promise<void> {
    if (connected) await connect();

    console.log('Web socket connection closed');
  }

  function appendMessage(
    role: Hume.empathicVoice.Role,
    content: string,
    topThreeEmotions: { emotion: string; score: any }[]
  ): void {
    const chatCard = new ChatCard({
      role,
      timestamp: new Date().toLocaleTimeString(),
      content,
      scores: topThreeEmotions,
    });

    chat?.appendChild(chatCard.render());

    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  function extractTopThreeEmotions(
    message: Hume.empathicVoice.UserMessage | Hume.empathicVoice.AssistantMessage
  ): { emotion: string;): { emotion: string; score: string }[] {
    const scores = message.models.prosody?.scores;

    const scoresArray = Object.entries(scores || {});

    scoresArray.sort((a, b) => b[1] - a[1]);

    const topThreeEmotions = scoresArray.slice(0, 3).map(([emotion, score]) => ({
      emotion,
      score: (Math.round(Number(score) * 100) / 100).toFixed(2),
    }));

    return topThreeEmotions;
  }
})();

/**
 * The code below does not pertain to the EVI implementation, and only serves to style the UI.
 */

interface Score {
  emotion: string;
  score: string;
}

interface ChatMessage {
  role: Hume.empathicVoice.Role;
  timestamp: string;
  content: string;
  scores: Score[];
}

class ChatCard {
  private message: ChatMessage;

  constructor(message: ChatMessage) {
    this.message = message;
  }

  private createScoreItem(score: Score): HTMLElement {
    const scoreItem = document.createElement('div');
    scoreItem.className = 'score-item';
    scoreItem.innerHTML = `${score.emotion}: <strong>${score.score}</strong>`;
    return scoreItem;
  }

  public render(): HTMLElement {
    const card = document.createElement('div');
    card.className = `chat-card ${this.message.role}`;

    const role = document.createElement('div');
    role.className = 'role';
    role.textContent =
      this.message.role.charAt(0).toUpperCase() + this.message.role.slice(1);

    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.innerHTML = `<strong>${this.message.timestamp}</strong>`;

    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = this.message.content;

    const scores = document.createElement('div');
    scores.className = 'scores';
    this.message.scores.forEach((score) => {
      scores.appendChild(this.createScoreItem(score));
    });

    card.appendChild(role);
    card.appendChild(timestamp);
    card.appendChild(content);
    card.appendChild(scores);

    return card;
  }
}
