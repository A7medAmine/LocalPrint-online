# PrintShop Hub - Installation Guide

## Quick Installation (Windows)

### Method 1: Automated Setup (Recommended)

1. **Download or clone** the PrintShop Hub repository to your computer
2. **Run as Administrator**: Right-click `setup.bat` and select "Run as administrator"
3. **Follow the prompts**: The script will handle everything automatically

### Method 2: Manual Installation

1. **Install Node.js** (if not already installed)
   - Download from: https://nodejs.org/
   - Run the installer and follow the setup wizard

2. **Install Dependencies**

   ```cmd
   cd path/to/PrintShopHub
   npm install
   ```

3. **Run the Application**

   ```cmd
   npm run dev
   ```

4. **Access the Application**
   - Open your browser and go to: http://localhost:3000

## What the Setup Script Does

The `setup.bat` script automatically:

✅ **Checks for administrator privileges**  
✅ **Verifies Node.js installation**  
✅ **Installs all required dependencies**  
✅ **Creates a startup script** for automatic Windows startup  
✅ **Creates a desktop shortcut** for easy access  
✅ **Creates an uninstall script** for clean removal  
✅ **Starts the application** and opens it in your browser

## Features Installed

- **Automatic Startup**: Application starts when you log into Windows
- **Desktop Shortcut**: Quick access from your desktop
- **Background Service**: Runs minimized in the background
- **Auto Browser Launch**: Opens automatically in your default browser
- **Clean Uninstall**: Easy removal with uninstall script

## Uninstallation

To remove PrintShop Hub from your system:

1. Navigate to the installation folder
2. Run `uninstall.bat` as administrator
3. Delete the installation folder if desired

## System Requirements

- **Windows 10 or 11**
- **Administrator privileges**
- **Node.js 16.0 or higher**
- **Internet connection** (for initial setup)

## Troubleshooting

### "Node.js is not installed"

- Download and install Node.js from https://nodejs.org/
- Restart your computer
- Run the setup script again

### "Please run as administrator"

- Right-click the setup script
- Select "Run as administrator"

### Application doesn't start

- Check that Node.js is properly installed
- Verify the installation folder path doesn't contain special characters
- Try running `npm run dev` manually in the installation folder

### Port already in use

- The application uses ports 3000 (frontend) and 3001 (backend)
- Make sure these ports are not blocked by other applications
- Restart your computer to clear any stuck processes

## File Locations After Installation

- **Application**: Your chosen installation folder
- **Startup Script**: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PrintShopHub.bat`
- **Desktop Shortcut**: `%USERPROFILE%\Desktop\PrintShop Hub.lnk`
- **Uninstall Script**: Your installation folder\uninstall.bat

## Support

For technical support or questions:

- Check the troubleshooting section above
- Ensure all system requirements are met
- Verify the installation completed successfully

---

**PrintShop Hub** - Professional Print Shop Management System  
Made with ❤️ for print shop owners
