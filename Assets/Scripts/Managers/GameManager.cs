using UnityEngine;

public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }

    int coinCount;
    int lives;

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
    }

    public void AddCoin()
    {
        coinCount++;
        UIManager.Instance.UpdateCoins(coinCount);
    }

    public void UpdateLives(int newLives)
    {
        lives = newLives;
        UIManager.Instance.UpdateLives(lives);
    }
}
