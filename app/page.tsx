"use client";

import { Check, ClipboardPaste, Clock, Copy, FileSpreadsheet, ShieldCheck, Terminal, Server, Key, Folder, Download, Zap, Database } from "lucide-react";
import * as motion from "motion/react-client";
import { useState } from "react";

const APPS_SCRIPT_CODE = `/**
 * Configuration Constants
 * Replace these with your actual Google Drive Folder IDs
 */
const SOURCE_FOLDER_ID = 'YOUR_SOURCE_FOLDER_ID_HERE';
const DESTINATION_FOLDER_ID = 'YOUR_DESTINATION_FOLDER_ID_HERE';

/**
 * Main function to scan and copy new Google Sheets
 */
function copyNewGoogleSheets() {
  try {
    // 1. Verify Folders before proceeding
    let sourceFolder, destFolder;
    try {
      sourceFolder = DriveApp.getFolderById(SOURCE_FOLDER_ID);
    } catch (e) {
      console.error(\`Error: Source folder with ID '\${SOURCE_FOLDER_ID}' not found or inaccessible.\`);
      return; 
    }

    try {
      destFolder = DriveApp.getFolderById(DESTINATION_FOLDER_ID);
    } catch (e) {
      console.error(\`Error: Destination folder with ID '\${DESTINATION_FOLDER_ID}' not found or inaccessible.\`);
      return;
    }

    // 2. State Management via PropertiesService (O(1) lookups)
    const scriptProperties = PropertiesService.getScriptProperties();
    const processedFilesString = scriptProperties.getProperty('PROCESSED_FILES');
    
    // Parse existing processed IDs, or initialize empty object
    const processedFiles = processedFilesString ? JSON.parse(processedFilesString) : {};

    // 3. Iterate over files in the source folder
    const files = sourceFolder.searchFiles(\`mimeType = '\${MimeType.GOOGLE_SHEETS}'\`);

    let hasUpdates = false;

    while (files.hasNext()) {
      const file = files.next();
      const fileId = file.getId();

      if (processedFiles[fileId]) continue;

      try {
        const fileName = file.getName();
        file.makeCopy(fileName, destFolder);
        console.log(\`Successfully copied: \${fileName} (\${fileId})\`);

        processedFiles[fileId] = true;
        hasUpdates = true;
      } catch (fileError) {
        console.error(\`Failed to copy '\${file.getName()}' (\${fileId}). Error: \${fileError.message}\`);
      }
    }

    // 4. Save state back to PropertiesService only if there were updates
    if (hasUpdates) {
      scriptProperties.setProperty('PROCESSED_FILES', JSON.stringify(processedFiles));
      console.log('Processed files state updated successfully.');
    } else {
      console.log('No new files to copy.');
    }

  } catch (globalError) {
    console.error(\`Critical script error: \${globalError.message}\`);
  }
}

/**
 * Programmatically sets up a time-driven trigger to run every 1 hour.
 */
function createTimeDrivenTrigger() {
  const functionName = 'copyNewGoogleSheets';
  const triggers = ScriptApp.getProjectTriggers();
  const existingTrigger = triggers.find(trigger => trigger.getHandlerFunction() === functionName);

  if (existingTrigger) {
    console.log(\`Trigger for \${functionName} already exists.\`);
    return;
  }

  try {
    ScriptApp.newTrigger(functionName)
      .timeBased()
      .everyHours(1)
      .create();
    console.log(\`Successfully created a 1-hour time-driven trigger for \${functionName}.\`);
  } catch (e) {
    console.error(\`Failed to create trigger: \${e.message}\`);
  }
}
`;

const TELEGRAM_PYTHON_CODE = `"""
Telegram to Google Drive Sheet Copier
Automates extraction of Google Sheet links from Telegram and copies them to Google Drive.
"""
import re
import logging
from telethon import TelegramClient, events
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ==========================================
# CONFIGURATION
# ==========================================

# 1. Telegram settings (Get from my.telegram.org)
API_ID = 'YOUR_API_ID_HERE' 
API_HASH = 'YOUR_API_HASH_HERE'
TARGET_CHANNEL = 'YOUR_CHANNEL_USERNAME_OR_ID' # e.g., '@finance_alerts' or '-100123456789'

# 2. Google Drive settings
SERVICE_ACCOUNT_FILE = 'credentials.json'
DESTINATION_FOLDER_ID = 'YOUR_DESTINATION_FOLDER_ID_HERE'

# ==========================================
# INITIALIZATION
# ==========================================

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Regex to extract Google Sheet ID from URLs
SHEET_REGEX = re.compile(r'docs\\.google\\.com/spreadsheets/d/([a-zA-Z0-9-_]+)')

# Initialize Google Drive API
try:
    scopes = ['https://www.googleapis.com/auth/drive']
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=scopes)
    drive_service = build('drive', 'v3', credentials=creds)
    logger.info("Google Drive API initialized successfully.")
except Exception as e:
    logger.error(f"Failed to initialize Google Drive API. Check credentials.json: {e}")
    exit(1)

# Initialize Telethon Client (User-bot)
client = TelegramClient('sheet_copier_session', API_ID, API_HASH)

# ==========================================
# EVENT HANDLER
# ==========================================

@client.on(events.NewMessage(chats=TARGET_CHANNEL))
async def message_handler(event):
    message_text = event.message.message
    if not message_text:
        return

    # 1. Extract Sheet IDs
    matches = SHEET_REGEX.findall(message_text)
    if not matches:
        return

    logger.info(f"Found {len(matches)} potential Sheet link(s) in new message.")

    # 2. Process unique IDs
    for sheet_id in set(matches):
        try:
            logger.info(f"Processing Sheet ID: {sheet_id}")
            
            # (Optional) Try to get original file name
            try:
                original = drive_service.files().get(
                    fileId=sheet_id, fields='name', supportsAllDrives=True
                ).execute()
                original_name = original.get('name', 'Copied Sheet')
            except HttpError:
                original_name = f"Extracted_Sheet_{sheet_id[:6]}"
                
            file_metadata = {
                'name': f"[Auto-Copied] {original_name}",
                'parents': [DESTINATION_FOLDER_ID]
            }

            # 3. Copy via API
            copied_file = drive_service.files().copy(
                fileId=sheet_id,
                body=file_metadata,
                supportsAllDrives=True
            ).execute()
            
            logger.info(f"SUCCESS: Saved '{original_name}' -> New ID: {copied_file['id']}")

        except HttpError as api_err:
            logger.error(f"API Error copying {sheet_id}. Check permissions/quota. Reason: {api_err.reason}")
        except Exception as e:
            logger.error(f"Unexpected error processing {sheet_id}: {str(e)}")

# ==========================================
# MAIN LOOP
# ==========================================

async def main():
    logger.info("Authenticating Telegram User-bot...")
    await client.start()
    logger.info(f"System Operational. Listening to {TARGET_CHANNEL}...")
    await client.run_until_disconnected()

if __name__ == '__main__':
    client.loop.run_until_complete(main())
`;

export default function Page() {
  const [activeTab, setActiveTab] = useState<'appscript' | 'python'>('python');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const codeToCopy = activeTab === 'appscript' ? APPS_SCRIPT_CODE : TELEGRAM_PYTHON_CODE;
    await navigator.clipboard.writeText(codeToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col min-h-screen overflow-hidden bg-[#0a0a0a] text-[#e0e0e0] font-sans selection:bg-white/20">
      
      {/* Header matching Sophisticated Dark theme */}
      <header className="h-20 border-b border-white/10 flex items-center justify-between px-6 lg:px-10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-white/5 border border-white/20 flex items-center justify-center">
            <div className="w-3 h-3 bg-white"></div>
          </div>
          <div>
            <h1 className="font-serif italic text-xl tracking-tight text-white">
              SheetClone Automator <span className="text-xs font-sans not-italic font-bold opacity-30 ml-2 uppercase tracking-widest">v2.5.0</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-40">System Dashboard • Production Environment</p>
          </div>
        </div>
        <div className="hidden sm:flex gap-8">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest opacity-40">System Status</p>
            <p className="text-xs font-medium text-emerald-400">● OPERATIONAL</p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 overflow-auto flex-col md:flex-row">
        
        {/* Sidebar Nav */}
        <aside className="w-full md:w-80 border-b md:border-b-0 md:border-r border-white/10 p-6 lg:p-8 flex flex-col gap-10 shrink-0 bg-[#0a0a0a] z-10 text-left">
          <section>
            <h2 className="font-serif italic text-lg text-white mb-6">Automation Engines</h2>
            <div className="space-y-3">
              <button 
                onClick={() => setActiveTab('python')}
                className={`w-full flex items-center gap-3 px-4 py-3 border text-left transition-colors ${
                  activeTab === 'python' 
                    ? 'bg-white/10 border-white/20 text-white' 
                    : 'bg-white/[0.02] border-white/5 text-white/50 hover:bg-white/5'
                }`}
              >
                <Server className="w-4 h-4 opacity-70" />
                <div>
                  <div className="text-sm font-medium">Telegram User-bot</div>
                  <div className="text-[10px] uppercase tracking-widest opacity-60 mt-1">Python • Telethon</div>
                </div>
              </button>
              
              <button 
                onClick={() => setActiveTab('appscript')}
                className={`w-full flex items-center gap-3 px-4 py-3 border text-left transition-colors ${
                  activeTab === 'appscript' 
                    ? 'bg-white/10 border-white/20 text-white' 
                    : 'bg-white/[0.02] border-white/5 text-white/50 hover:bg-white/5'
                }`}
              >
                <Database className="w-4 h-4 opacity-70" />
                <div>
                  <div className="text-sm font-medium">Drive Watcher</div>
                  <div className="text-[10px] uppercase tracking-widest opacity-60 mt-1">Google Apps Script</div>
                </div>
              </button>
            </div>
          </section>

          <section className="hidden md:block">
            <h2 className="font-serif italic text-lg text-white mb-6">Execution Params</h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-xs">
                <span className="opacity-60">Source Link</span>
                <span className="text-white font-medium">{activeTab === 'python' ? 'Telegram Channel' : 'Drive Folder'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="opacity-60">Architecture</span>
                <span className="text-emerald-400">{activeTab === 'python' ? 'Local / Server' : 'Cloud Native'}</span>
              </div>
            </div>
          </section>
        </aside>

        {/* Content Area */}
        <section className="flex-1 flex flex-col p-6 lg:p-10 overflow-auto">
          
          <div className="flex flex-col xl:flex-row gap-10">
            {/* Code Block */}
            <div className="flex-1 min-w-0">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="relative bg-white/[0.02] border border-white/10 flex flex-col h-[500px] xl:h-[calc(100vh-10rem)]"
              >
                <div className="flex items-center justify-between px-4 py-3 bg-white/5 border-b border-white/10 shrink-0">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 opacity-60" />
                    <span className="text-sm font-serif italic text-white tracking-wide">
                      {activeTab === 'python' ? 'bot.py' : 'Code.gs'}
                    </span>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/10 border border-white/20 text-[10px] uppercase tracking-widest hover:bg-white/20 transition-colors focus:outline-none focus:ring-1 focus:ring-white/50 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-4 sm:p-6 overflow-y-auto flex-1">
                  <pre className="text-[11px] sm:text-xs leading-relaxed opacity-80 font-mono">
                    <code>{activeTab === 'python' ? TELEGRAM_PYTHON_CODE : APPS_SCRIPT_CODE}</code>
                  </pre>
                </div>
              </motion.div>
            </div>

            {/* Instructions Block */}
            <div className="w-full xl:w-[450px] shrink-0 text-left">
              <motion.div
                key={activeTab + "-instructions"}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="space-y-6"
              >
                <div className="flex items-end justify-between mb-2">
                  <h2 className="font-serif italic text-3xl text-white tracking-tighter">Deployment Manual</h2>
                </div>

                {activeTab === 'python' ? (
                  <div className="space-y-4">
                    <Step 
                      num="01" 
                      title="Obtain Telegram Credentials"
                      content={
                        <ol className="list-decimal list-inside space-y-1.5 opacity-80 text-xs text-left">
                          <li>Go to <a href="https://my.telegram.org/" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">my.telegram.org</a> and log in.</li>
                          <li>Click on <strong>API development tools</strong>.</li>
                          <li>Create a new application (fill in random details if needed).</li>
                          <li>Copy the <strong>App api_id</strong> and <strong>App api_hash</strong> into the script where indicated.</li>
                        </ol>
                      }
                    />
                    <Step 
                      num="02" 
                      title="Set Up Google Service Account"
                      content={
                        <ol className="list-decimal list-inside space-y-1.5 opacity-80 text-xs text-balance text-left">
                          <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">Google Cloud Console</a>.</li>
                          <li>Create a new Project.</li>
                          <li>Go to <strong>APIs & Services {'>'} Library</strong> and enable the <strong>Google Drive API</strong>.</li>
                          <li>Go to <strong>Credentials {'>'} Create Credentials {'>'} Service Account</strong>.</li>
                          <li>Under the keys tab of your new account, add a New Key (JSON type) and download it.</li>
                          <li>Rename the file to <code>credentials.json</code> and place it in the same folder as your python script.</li>
                        </ol>
                      }
                    />
                    <Step 
                      num="03" 
                      title="Share the Destination Folder"
                      content={
                        <ol className="list-decimal list-inside space-y-1.5 opacity-80 text-xs text-left">
                          <li>Open your <code>credentials.json</code> and copy the <code>client_email</code> address inside.</li>
                          <li>In Google Drive, right-click your Destination Folder and click <strong>Share</strong>.</li>
                          <li>Paste the Service Account email and give it <strong>Editor</strong> access.</li>
                          <li>Copy the folder ID from the URL and paste it into <code>DESTINATION_FOLDER_ID</code> in the script.</li>
                        </ol>
                      }
                    />
                    <Step 
                      num="04" 
                      title="Install Dependencies & Run"
                      content={
                        <div className="space-y-3">
                          <div className="p-2 bg-white/5 border border-white/10 font-mono text-[10px] break-all text-emerald-400">
                            pip install telethon google-api-python-client google-auth-httplib2 google-auth-oauthlib
                          </div>
                          <ol className="list-decimal list-inside space-y-1.5 opacity-80 text-xs text-balance text-left">
                            <li>Run the script with <code>python bot.py</code></li>
                            <li>The first time you run it, it will ask for your Telegram phone number and a login code sent to your app.</li>
                            <li>The bot will now listen to your specified channel and automatically copy any sheets!</li>
                          </ol>
                        </div>
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Step 
                      num="01" 
                      title="Create Apps Script Project"
                      content={
                        <ol className="list-decimal list-inside space-y-2 opacity-80 text-xs text-balance text-left">
                          <li>Go to <a href="https://script.google.com/" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">script.google.com</a>.</li>
                          <li>Click <strong>New project</strong>.</li>
                          <li>Delete the default code.</li>
                          <li>Click <strong>Copy Code</strong> and paste it into the editor.</li>
                        </ol>
                      }
                    />
                    <Step 
                      num="02" 
                      title="Extract Folder IDs"
                      content={
                        <ol className="list-decimal list-inside space-y-2 opacity-80 text-xs text-balance text-left">
                          <li>Open your Source Folder in Google Drive.</li>
                          <li>Copy the long string after <code>/folders/</code> in the URL.</li>
                          <li>Replace <code>'YOUR_SOURCE_FOLDER_ID_HERE'</code> in the script.</li>
                          <li>Repeat for your personal Destination Folder.</li>
                        </ol>
                      }
                    />
                    <Step 
                      num="03" 
                      title="Authorize Permissions"
                      content={
                        <ol className="list-decimal list-inside space-y-2 opacity-80 text-xs text-balance text-left">
                          <li>Save the script (Ctrl+S).</li>
                          <li>Ensure <code>copyNewGoogleSheets</code> is selected in the top toolbar dropdown.</li>
                          <li>Click <strong>Run</strong>.</li>
                          <li>Click <strong>Review permissions {'>'} Advanced {'>'} Go to project</strong>.</li>
                          <li>Click <strong>Allow</strong>.</li>
                        </ol>
                      }
                    />
                    <Step 
                      num="04" 
                      title="Enable Automation"
                      content={
                        <ol className="list-decimal list-inside space-y-2 opacity-80 text-xs text-left">
                          <li>In the top toolbar dropdown, select <strong><code>createTimeDrivenTrigger</code></strong>.</li>
                          <li>Click <strong>Run</strong>.</li>
                          <li>Check the Execution Log. The script will now scan your folder every hour automatically!</li>
                        </ol>
                      }
                    />
                  </div>
                )}
              </motion.div>
            </div>
          </div>
          
        </section>
      </main>
    </div>
  );
}

function Step({ num, title, content }: { num: string; title: string; content: React.ReactNode }) {
  return (
    <div className="flex gap-4 border border-white/10 p-5 bg-white/[0.02]">
      <div className="flex-shrink-0">
        <span className="font-serif italic text-xl text-emerald-400 opacity-80">{num}</span>
      </div>
      <div>
        <h3 className="font-serif italic text-lg text-white mb-2">{title}</h3>
        <div className="text-slate-300">
          {content}
        </div>
      </div>
    </div>
  );
}
