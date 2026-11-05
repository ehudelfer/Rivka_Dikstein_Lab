import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

def launch_ordering_website(user_email="user@weizmann.ac.il"):
    # Setup Chrome WebDriver
    options = webdriver.ChromeOptions()
    options.add_argument("--start-maximized")
    
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    
    try:
        # Navigate to the ordering website
        url = "http://127.0.0.1:5000"
        driver.get(url)
        time.sleep(2)

        # Locate email input and button
        email_input = driver.find_element(By.ID, "userEmail")
        verify_btn = driver.find_element(By.XPATH, "//button[contains(text(),'Verify Email')]")

        # Enter email and verify authorization
        email_input.send_keys(user_email)
        verify_btn.click()
        
        print(f"Browser successfully launched and logged in with email: {user_email}")
        
        # Keep browser open for demonstration
        time.sleep(60)

    except Exception as e:
        print(f"An error occurred while launching the browser: {e}")
    finally:
        driver.quit()

if __name__ == "__main__":
    # Test launch with a Weizmann user email
    launch_ordering_website("researcher@weizmann.ac.il")